#!/usr/bin/lua

local AT_HELPER = os.getenv("SMS_FORWARD_AT_HELPER") or "/usr/share/3ginfo-lite/sms-mtk-at.sh"
local SEND_HELPER = os.getenv("SMS_FORWARD_SEND_HELPER") or "/usr/share/3ginfo-lite/sms-mtk-send.sh"
local OUTBOX_HELPER = os.getenv("SMS_FORWARD_OUTBOX_HELPER") or "/usr/share/3ginfo-lite/sms-outbox.sh"
local STATE_FILE = os.getenv("SMS_FORWARD_STATE_FILE") or "/etc/3ginfo-lite/sms-forward.state"
local STATUS_FILE = os.getenv("SMS_FORWARD_STATUS_FILE") or "/tmp/3ginfo_sms_forward.status"
local UBUS_OBJECT = "ril.unsol.sms.pdu"
local POLL_INTERVAL = 20
local MAX_DONE_RECORDS = 4096
local FORWARD_MARKER = "[SMS Forward]"
-- Modem > Notifications decides whether and where a received message is announced.
local NOTIFY_HELPER = os.getenv("SMS_FORWARD_NOTIFY_HELPER") or "/usr/bin/junwrt-notify"

local function trim(value)
	return tostring(value or ""):gsub("^%s+", ""):gsub("%s+$", "")
end

local function shell_quote(value)
	return "'" .. tostring(value or ""):gsub("'", "'\\''") .. "'"
end

local BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

local function base64_encode(value)
	value = tostring(value or "")
	local encoded = {}
	for position = 1, #value, 3 do
		local first = value:byte(position)
		local second = value:byte(position + 1)
		local third = value:byte(position + 2)
		local combined = first * 65536 + (second or 0) * 256 + (third or 0)
		encoded[#encoded + 1] = BASE64_ALPHABET:sub(math.floor(combined / 262144) % 64 + 1,
			math.floor(combined / 262144) % 64 + 1)
		encoded[#encoded + 1] = BASE64_ALPHABET:sub(math.floor(combined / 4096) % 64 + 1,
			math.floor(combined / 4096) % 64 + 1)
		encoded[#encoded + 1] = second and BASE64_ALPHABET:sub(math.floor(combined / 64) % 64 + 1,
			math.floor(combined / 64) % 64 + 1) or "="
		encoded[#encoded + 1] = third and BASE64_ALPHABET:sub(combined % 64 + 1, combined % 64 + 1) or "="
	end
	return table.concat(encoded)
end

local function command_succeeded(result)
	return result == true or result == 0
end

local function run_capture(command)
	local pipe = io.popen(command .. " 2>&1", "r")
	if not pipe then
		return nil, false
	end

	local output = pipe:read("*a") or ""
	local result = pipe:close()
	return output, command_succeeded(result)
end

local function sleep_seconds(seconds)
	seconds = tonumber(seconds) or 0
	if seconds <= 0 then
		return
	end

	local ok, socket = pcall(require, "socket")
	if ok and socket and socket.sleep then
		socket.sleep(seconds)
	else
		os.execute("sleep " .. tostring(math.floor(seconds)))
	end
end

local function ensure_parent(path)
	local directory = tostring(path):match("^(.*)/[^/]+$")
	if directory and directory ~= "" then
		os.execute("mkdir -p " .. shell_quote(directory) .. " >/dev/null 2>&1")
	end
end

local function write_atomic(path, content, mode)
	ensure_parent(path)
	local temporary = path .. ".tmp"
	local file, err = io.open(temporary, "w")
	if not file then
		return nil, err
	end

	file:write(content)
	file:flush()
	file:close()
	if mode then
		os.execute("chmod " .. tostring(mode) .. " " .. shell_quote(temporary) .. " >/dev/null 2>&1")
	end
	local ok, rename_err = os.rename(temporary, path)
	if not ok then
		os.remove(temporary)
		return nil, rename_err
	end
	return true
end

local function log(level, message)
	message = trim(message):gsub("[\r\n]", " "):sub(1, 300)
	os.execute("logger -t sms-forward -p " .. shell_quote("daemon." .. level) .. " -- " .. shell_quote(message) .. " >/dev/null 2>&1")
end

local function uci_get(option)
	local command = "uci -q get " .. shell_quote("3ginfo.@3ginfo[0]." .. option)
	local output, ok = run_capture(command)
	if not ok then
		return nil
	end
	return trim(output)
end

local function normalize_storage(value)
	value = trim(value):upper()
	if value == "SM" or value == "ME" or value == "MT" then
		return value
	end
	return "SM"
end

local function normalize_number(value)
	value = trim(value)
	if not value:match("^%+?%d+$") then
		return nil
	end
	local digits = value:gsub("^%+", "")
	if #digits < 5 or #digits > 15 then
		return nil
	end
	return value:sub(1, 1) == "+" and ("+" .. digits) or digits
end

local function read_config()
	return {
		enabled = uci_get("sms_forward_enabled") == "1",
		notify = uci_get("sms_notify") == "1",
		number = normalize_number(uci_get("sms_forward_number")),
		storage = normalize_storage(uci_get("sms_storage"))
	}
end

local runtime = {
	STATE = "starting",
	LAST_SCAN = "0",
	LAST_FORWARD = "0",
	LAST_ERROR = "",
	FORWARDED_COUNT = "0",
	PENDING_COUNT = "0",
	SKIPPED_COUNT = "0",
	STORAGE = "SM",
	TARGET = ""
}

local function load_runtime()
	local file = io.open(STATUS_FILE, "r")
	if not file then
		return
	end
	for line in file:lines() do
		local key, value = line:match("^([A-Z_]+)=(.*)$")
		if key and runtime[key] ~= nil then
			runtime[key] = value
		end
	end
	file:close()
end

local function status_value(value)
	return tostring(value or ""):gsub("[\r\n\t]", " "):sub(1, 300)
end

local function mask_number(number)
	if not number or #number < 7 then
		return number or ""
	end
	return number:sub(1, 3) .. "***" .. number:sub(-4)
end

local function save_runtime()
	local keys = {
		"STATE", "LAST_SCAN", "LAST_FORWARD", "LAST_ERROR",
		"FORWARDED_COUNT", "PENDING_COUNT", "SKIPPED_COUNT",
		"STORAGE", "TARGET"
	}
	local lines = {}
	for _, key in ipairs(keys) do
		lines[#lines + 1] = key .. "=" .. status_value(runtime[key])
	end
	write_atomic(STATUS_FILE, table.concat(lines, "\n") .. "\n", "600")
end

local last_logged_error, last_error_log_time = nil, 0

local function set_error(message)
	runtime.STATE = "error"
	runtime.LAST_ERROR = status_value(message)
	save_runtime()
	local now = os.time()
	if runtime.LAST_ERROR ~= last_logged_error or now - last_error_log_time >= 300 then
		log("err", message)
		last_logged_error = runtime.LAST_ERROR
		last_error_log_time = now
	end
end

local function has_at_error(output)
	for line in tostring(output or ""):gmatch("[^\r\n]+") do
		line = trim(line)
		if line == "ERROR" or line:match("^%+CME ERROR:") or line:match("^%+CMS ERROR:") then
			return true
		end
	end
	return false
end

local function has_at_ok(output)
	if has_at_error(output) then return false end
	for line in tostring(output or ""):gmatch("[^\r\n]+") do
		if trim(line) == "OK" then return true end
	end
	return false
end

local function run_at(storage, command)
	local output, ok = run_capture(shell_quote(AT_HELPER) .. " " .. shell_quote(storage) .. " " .. shell_quote(command))
	if not ok or not has_at_ok(output) then
		return nil, trim(output or "AT command failed")
	end
	return output
end

local function query_sim_identity(storage)
	local output, err = run_at(storage, "AT+CCID")
	if output then
		for line in output:gmatch("[^\r\n]+") do
			local candidate = line:match("%+CCID:%s*\"?([0-9A-Fa-f]+)") or
				line:match("%+ICCID:%s*\"?([0-9A-Fa-f]+)")
			if candidate and #candidate >= 10 and #candidate <= 24 then
				return candidate:upper(), "iccid"
			end
		end
	end

	local imsi_output, imsi_error = run_at(storage, "AT+CIMI")
	if imsi_output then
		for line in imsi_output:gmatch("[^\r\n]+") do
			line = trim(line)
			if line:match("^%d+$") and #line >= 10 and #line <= 18 then
				return line, "imsi"
			end
		end
	end
	return nil, nil, imsi_error or err or "AT+CCID and AT+CIMI returned no SIM identity"
end

local hash_cache, hash_cache_order = {}, {}

local function sha256(value)
	if hash_cache[value] then return hash_cache[value] end
	local temporary_output, temporary_ok = run_capture("mktemp /tmp/3ginfo-sms-hash.XXXXXX")
	local temporary = temporary_ok and trim(temporary_output) or nil
	local file = temporary and io.open(temporary, "wb")
	if not file then
		if temporary then os.remove(temporary) end
		return nil
	end
	file:write(value)
	file:close()
	local output, ok = run_capture("sha256sum " .. shell_quote(temporary))
	os.remove(temporary)
	local digest = output and output:match("^([0-9a-fA-F]+)")
	if ok and digest and #digest == 64 then
		digest = digest:lower()
		hash_cache[value] = digest
		hash_cache_order[#hash_cache_order + 1] = value
		if #hash_cache_order > 512 then
			hash_cache[table.remove(hash_cache_order, 1)] = nil
		end
		return digest
	end
	return nil
end

local function new_state()
	return {
		version = 1,
		identity = "",
		storage = "",
		initialized = false,
		done = {},
		done_order = {},
		progress = {}
	}
end

local function load_state()
	local state = new_state()
	local file = io.open(STATE_FILE, "r")
	if not file then
		return state
	end

	for line in file:lines() do
		local fields = {}
		for field in (line .. "\t"):gmatch("(.-)\t") do
			fields[#fields + 1] = field
		end
		if fields[1] == "identity" then
			local identity = fields[2] or ""
			state.identity = #identity == 64 and identity:match("^[0-9a-f]+$") and identity or ""
			state.storage = fields[3] or ""
			state.initialized = fields[4] == "1"
		elseif fields[1] == "done" and fields[2] and fields[2]:match("^[0-9a-f]+$") then
			local timestamp = tonumber(fields[3]) or 0
			state.done[fields[2]] = timestamp
			state.done_order[#state.done_order + 1] = { digest = fields[2], timestamp = timestamp }
		elseif fields[1] == "progress" and fields[2] and fields[2]:match("^[0-9a-f]+$") then
			state.progress[fields[2]] = {
				next_part = tonumber(fields[3]) or 1,
				total = tonumber(fields[4]) or 1,
				target = fields[5] or "",
				timestamp = tonumber(fields[6]) or 0
			}
		end
	end
	file:close()
	return state
end

local function save_state(state)
	local lines = {
		"sms-forward-state\t1",
		table.concat({ "identity", state.identity or "", state.storage or "", state.initialized and "1" or "0" }, "\t")
	}

	for _, record in ipairs(state.done_order) do
		if state.done[record.digest] == record.timestamp then
			lines[#lines + 1] = table.concat({ "done", record.digest, tostring(record.timestamp) }, "\t")
		end
	end
	for digest, progress in pairs(state.progress) do
		lines[#lines + 1] = table.concat({
			"progress", digest, tostring(progress.next_part), tostring(progress.total),
			progress.target or "", tostring(progress.timestamp or 0)
		}, "\t")
	end
	return write_atomic(STATE_FILE, table.concat(lines, "\n") .. "\n", "600")
end

local function reset_state_identity(state, identity, storage)
	state.identity = identity
	state.storage = storage
	state.initialized = false
	state.done = {}
	state.done_order = {}
	state.progress = {}
end

local function mark_done(state, digest, timestamp)
	if not digest or state.done[digest] then
		return
	end
	timestamp = timestamp or os.time()
	state.done[digest] = timestamp
	state.done_order[#state.done_order + 1] = { digest = digest, timestamp = timestamp }
end

local function prune_done(state, keep)
	if #state.done_order <= MAX_DONE_RECORDS then
		return
	end
	local remove_count = #state.done_order - MAX_DONE_RECORDS
	local retained = {}
	for _, record in ipairs(state.done_order) do
		if remove_count > 0 and not (keep and keep[record.digest]) then
			if state.done[record.digest] == record.timestamp then
				state.done[record.digest] = nil
			end
			remove_count = remove_count - 1
		else
			retained[#retained + 1] = record
		end
	end
	state.done_order = retained
end

local function utf8_char(codepoint)
	if codepoint < 0 then
		codepoint = 0xFFFD
	end
	if codepoint <= 0x7F then
		return string.char(codepoint)
	elseif codepoint <= 0x7FF then
		return string.char(0xC0 + math.floor(codepoint / 0x40), 0x80 + codepoint % 0x40)
	elseif codepoint <= 0xFFFF then
		return string.char(
			0xE0 + math.floor(codepoint / 0x1000),
			0x80 + math.floor(codepoint / 0x40) % 0x40,
			0x80 + codepoint % 0x40
		)
	elseif codepoint <= 0x10FFFF then
		return string.char(
			0xF0 + math.floor(codepoint / 0x40000),
			0x80 + math.floor(codepoint / 0x1000) % 0x40,
			0x80 + math.floor(codepoint / 0x40) % 0x40,
			0x80 + codepoint % 0x40
		)
	end
	return utf8_char(0xFFFD)
end

local GSM7_BASE = {
	[0] = 0x0040, 0x00A3, 0x0024, 0x00A5, 0x00E8, 0x00E9, 0x00F9, 0x00EC,
	0x00F2, 0x00C7, 0x000A, 0x00D8, 0x00F8, 0x000D, 0x00C5, 0x00E5,
	0x0394, 0x005F, 0x03A6, 0x0393, 0x039B, 0x03A9, 0x03A0, 0x03A8,
	0x03A3, 0x0398, 0x039E, false, 0x00C6, 0x00E6, 0x00DF, 0x00C9
}

for code = 0x20, 0x3F do GSM7_BASE[code] = code end
GSM7_BASE[0x40] = 0x00A1
for code = 0x41, 0x5A do GSM7_BASE[code] = code end
GSM7_BASE[0x5B], GSM7_BASE[0x5C], GSM7_BASE[0x5D], GSM7_BASE[0x5E] = 0x00C4, 0x00D6, 0x00D1, 0x00DC
GSM7_BASE[0x5F], GSM7_BASE[0x60] = 0x00A7, 0x00BF
for code = 0x61, 0x7A do GSM7_BASE[code] = code end
GSM7_BASE[0x7B], GSM7_BASE[0x7C], GSM7_BASE[0x7D], GSM7_BASE[0x7E], GSM7_BASE[0x7F] = 0x00E4, 0x00F6, 0x00F1, 0x00FC, 0x00E0

local GSM7_EXTENSION = {
	[0x0A] = 0x000C, [0x14] = 0x005E, [0x28] = 0x007B, [0x29] = 0x007D,
	[0x2F] = 0x005C, [0x3C] = 0x005B, [0x3D] = 0x007E, [0x3E] = 0x005D,
	[0x40] = 0x007C, [0x65] = 0x20AC
}

local function decode_gsm7_values(values)
	local output = {}
	local escaped = false
	for _, value in ipairs(values) do
		if escaped then
			output[#output + 1] = utf8_char(GSM7_EXTENSION[value] or 0x003F)
			escaped = false
		elseif value == 0x1B then
			escaped = true
		else
			output[#output + 1] = utf8_char(GSM7_BASE[value] or 0x003F)
		end
	end
	if escaped then
		output[#output + 1] = "?"
	end
	return table.concat(output)
end

local function unpack_septets(bytes, bit_offset, count)
	local values = {}
	for index = 0, count - 1 do
		local bit = bit_offset + index * 7
		local byte_index = math.floor(bit / 8) + 1
		local shift = bit % 8
		local low = bytes[byte_index]
		if low == nil then
			break
		end
		local value = math.floor(low / (2 ^ shift))
		if shift > 1 and bytes[byte_index + 1] then
			value = value + bytes[byte_index + 1] * (2 ^ (8 - shift))
		end
		values[#values + 1] = value % 128
	end
	return values
end

local function decode_ucs2(bytes, offset, length)
	local output = {}
	local finish = math.min(#bytes, offset + length - 1)
	local index = offset
	while index + 1 <= finish do
		local unit = bytes[index] * 256 + bytes[index + 1]
		index = index + 2
		if unit >= 0xD800 and unit <= 0xDBFF and index + 1 <= finish then
			local low = bytes[index] * 256 + bytes[index + 1]
			if low >= 0xDC00 and low <= 0xDFFF then
				output[#output + 1] = utf8_char(0x10000 + (unit - 0xD800) * 0x400 + low - 0xDC00)
				index = index + 2
			else
				output[#output + 1] = utf8_char(0xFFFD)
			end
		elseif unit >= 0xD800 and unit <= 0xDFFF then
			output[#output + 1] = utf8_char(0xFFFD)
		else
			output[#output + 1] = utf8_char(unit)
		end
	end
	if index <= finish then
		output[#output + 1] = utf8_char(0xFFFD)
	end
	return table.concat(output)
end

local function hex_to_bytes(hex)
	hex = trim(hex)
	if #hex == 0 or #hex % 2 ~= 0 or not hex:match("^[0-9A-Fa-f]+$") then
		return nil
	end
	local bytes = {}
	for index = 1, #hex, 2 do
		bytes[#bytes + 1] = tonumber(hex:sub(index, index + 1), 16)
	end
	return bytes
end

local function semi_octets(bytes, digits)
	local output = {}
	for _, byte in ipairs(bytes) do
		local low, high = byte % 16, math.floor(byte / 16)
		if low <= 9 and #output < digits then output[#output + 1] = tostring(low) end
		if high <= 9 and #output < digits then output[#output + 1] = tostring(high) end
	end
	return table.concat(output)
end

local function decode_address(bytes, length, toa)
	if math.floor(toa / 16) % 8 == 5 then
		local septets = math.floor(length * 4 / 7)
		return decode_gsm7_values(unpack_septets(bytes, 0, septets))
	end
	local number = semi_octets(bytes, length)
	if math.floor(toa / 16) % 8 == 1 then
		return "+" .. number
	end
	return number
end

local function swapped_bcd(byte)
	local low, high = byte % 16, math.floor(byte / 16)
	if low > 9 or high > 9 then return nil end
	return low * 10 + high
end

local function decode_timestamp(bytes)
	if #bytes < 7 then return "", nil end
	local year, month, day = swapped_bcd(bytes[1]), swapped_bcd(bytes[2]), swapped_bcd(bytes[3])
	local hour, minute, second = swapped_bcd(bytes[4]), swapped_bcd(bytes[5]), swapped_bcd(bytes[6])
	if not year or not month or not day or not hour or not minute or not second then
		return "", nil
	end
	local timezone_byte = bytes[7]
	local negative = math.floor(timezone_byte / 8) % 2 == 1
	timezone_byte = timezone_byte - (negative and 8 or 0)
	local quarters = swapped_bcd(timezone_byte) or 0
	local timezone_minutes = quarters * 15 * (negative and -1 or 1)
	local sign = timezone_minutes < 0 and "-" or "+"
	local absolute = math.abs(timezone_minutes)
	local full_year = year >= 90 and 1900 + year or 2000 + year
	local text = string.format("%04d-%02d-%02d %02d:%02d:%02d %s%02d:%02d",
		full_year, month, day, hour, minute, second, sign, math.floor(absolute / 60), absolute % 60)
	local epoch
	if month >= 1 and month <= 12 and day >= 1 and day <= 31 and hour <= 23 and minute <= 59 and second <= 60 then
		epoch = os.time({ year = full_year, month = month, day = day, hour = hour, min = minute, sec = math.min(second, 59) })
	end
	return text, epoch
end

local function dcs_alphabet(dcs)
	if dcs < 0x40 then
		if math.floor(dcs / 0x20) % 2 == 1 then return nil, "compressed" end
		local alphabet = math.floor(dcs / 4) % 4
		if alphabet == 0 then return "gsm7" end
		if alphabet == 1 then return "binary" end
		if alphabet == 2 then return "ucs2" end
		return nil, "reserved alphabet"
	end
	local group = math.floor(dcs / 16)
	if group == 0xC or group == 0xD then return "gsm7" end
	if group == 0xE then return "ucs2" end
	if group == 0xF then
		return math.floor(dcs / 4) % 2 == 0 and "gsm7" or "binary"
	end
	return nil, "reserved DCS"
end

local function parse_udh(user_data, udhl)
	local info = {}
	local position = 2
	local finish = 1 + udhl
	while position + 1 <= finish do
		local identifier, length = user_data[position], user_data[position + 1]
		local first = position + 2
		local last = first + length - 1
		if not identifier or not length or last > finish then
			return nil, "truncated UDH"
		end
		if identifier == 0x00 and length == 3 then
			info.concat = { width = 8, reference = user_data[first], total = user_data[first + 1], part = user_data[first + 2] }
		elseif identifier == 0x08 and length == 4 then
			info.concat = { width = 16, reference = user_data[first] * 256 + user_data[first + 1], total = user_data[first + 2], part = user_data[first + 3] }
		elseif identifier == 0x04 or identifier == 0x05 then
			info.port_addressed = true
		elseif identifier == 0x24 or identifier == 0x25 then
			info.national_language = true
		end
		position = last + 1
	end
	return info
end

local function parse_pdu(raw, index)
	local bytes = hex_to_bytes(raw)
	if not bytes then return nil, "invalid hex" end
	local position = 1
	local smsc_length = bytes[position]
	if not smsc_length or 1 + smsc_length >= #bytes then return nil, "invalid SMSC length" end
	position = position + 1 + smsc_length

	local first_octet = bytes[position]
	if not first_octet then return nil, "missing first octet" end
	position = position + 1
	local mti = first_octet % 4
	if mti ~= 0 then return nil, "not SMS-DELIVER", mti end
	local udhi = math.floor(first_octet / 0x40) % 2 == 1

	local address_length, toa = bytes[position], bytes[position + 1]
	if not address_length or not toa then return nil, "missing sender" end
	position = position + 2
	local address_bytes_length = math.ceil(address_length / 2)
	if position + address_bytes_length - 1 > #bytes then return nil, "truncated sender" end
	local address_bytes = {}
	for i = 0, address_bytes_length - 1 do address_bytes[#address_bytes + 1] = bytes[position + i] end
	local sender = decode_address(address_bytes, address_length, toa)
	position = position + address_bytes_length

	local pid, dcs = bytes[position], bytes[position + 1]
	if not pid or not dcs then return nil, "missing PID/DCS" end
	position = position + 2
	if position + 6 > #bytes then return nil, "truncated timestamp" end
	local timestamp_bytes = {}
	for i = 0, 6 do timestamp_bytes[#timestamp_bytes + 1] = bytes[position + i] end
	local timestamp, timestamp_epoch = decode_timestamp(timestamp_bytes)
	position = position + 7

	local user_data_length = bytes[position]
	if not user_data_length then return nil, "missing UDL" end
	position = position + 1
	local alphabet, alphabet_error = dcs_alphabet(dcs)
	if not alphabet then return nil, alphabet_error end
	if alphabet == "binary" then return nil, "binary SMS" end
	local encoded_octets = alphabet == "gsm7" and math.ceil(user_data_length * 7 / 8) or user_data_length
	if encoded_octets < 0 or position + encoded_octets - 1 > #bytes then return nil, "truncated user data" end
	local user_data = {}
	for i = 0, encoded_octets - 1 do user_data[#user_data + 1] = bytes[position + i] end

	local header_octets = 0
	local udh = {}
	if udhi then
		local udhl = user_data[1]
		if not udhl or udhl + 1 > #user_data then return nil, "invalid UDH" end
		header_octets = udhl + 1
		local parsed, udh_error = parse_udh(user_data, udhl)
		if not parsed then return nil, udh_error end
		udh = parsed
		if udh.port_addressed then return nil, "port-addressed SMS" end
		if udh.national_language then return nil, "national language table unsupported" end
	end

	local content
	if alphabet == "ucs2" then
		local content_length = user_data_length - header_octets
		if content_length < 0 then return nil, "invalid UCS2 UDL" end
		content = decode_ucs2(user_data, header_octets + 1, content_length)
	else
		local header_septets = math.ceil(header_octets * 8 / 7)
		local content_septets = user_data_length - header_septets
		if content_septets < 0 then return nil, "invalid GSM7 UDL" end
		content = decode_gsm7_values(unpack_septets(user_data, header_septets * 7, content_septets))
	end

	if udh.concat then
		if not udh.concat.total or udh.concat.total < 2 or udh.concat.total > 255 or
			not udh.concat.part or udh.concat.part < 1 or udh.concat.part > udh.concat.total then
			return nil, "invalid concatenation header"
		end
	end

	return {
		index = tonumber(index) or 0,
		raw = raw:upper(),
		sender = sender,
		timestamp = timestamp,
		timestamp_epoch = timestamp_epoch,
		content = content,
		dcs = dcs,
		alphabet = alphabet,
		concat = udh.concat
	}
end

local function parse_inbox(output, identity_prefix)
	local entries, current = {}, nil
	for line in tostring(output or ""):gmatch("[^\r\n]+") do
		line = trim(line)
		local index = line:match("^%+CMGL:%s*(%d+)")
		if index then
			current = { index = tonumber(index), raw = nil }
			entries[#entries + 1] = current
		elseif current and not current.raw and #line >= 4 and #line % 2 == 0 and line:match("^[0-9A-Fa-f]+$") then
			current.raw = line:upper()
		end
	end

	local messages, ignored = {}, {}
	for _, entry in ipairs(entries) do
		if entry.raw then
			entry.raw_digest = sha256(identity_prefix .. "\0raw\0" .. entry.raw)
			local message, reason, mti = parse_pdu(entry.raw, entry.index)
			if message then
				message.raw_digest = entry.raw_digest
				messages[#messages + 1] = message
			else
				ignored[#ignored + 1] = { digest = entry.raw_digest, reason = reason, mti = mti }
			end
		end
	end
	return messages, ignored, entries
end

local function concat_group_key(message)
	local concat = message.concat
	return table.concat({
		message.sender or "", tostring(concat.width), tostring(concat.reference),
		tostring(concat.total), tostring(message.dcs)
	}, "\0")
end

local function timestamp_distance(left, right)
	if not left or not right then return 0 end
	return math.abs(left - right)
end

local function make_logical_message(parts, identity_prefix)
	table.sort(parts, function(a, b) return a.concat.part < b.concat.part end)
	local raw_values, raw_digests, content = {}, {}, {}
	local minimum_index = parts[1].index
	for _, part in ipairs(parts) do
		raw_values[#raw_values + 1] = part.raw
		raw_digests[#raw_digests + 1] = part.raw_digest
		content[#content + 1] = part.content
		if part.index < minimum_index then minimum_index = part.index end
	end
	return {
		index = minimum_index,
		sender = parts[1].sender,
		timestamp = parts[1].timestamp,
		content = table.concat(content),
		parts = parts,
		raw_digests = raw_digests,
		digest = sha256(identity_prefix .. "\0multi\0" .. table.concat(raw_values, "\0"))
	}
end

local function assemble_messages(messages, identity_prefix)
	local logical, incomplete = {}, {}
	local grouped = {}
	for _, message in ipairs(messages) do
		if not message.concat then
			logical[#logical + 1] = {
				index = message.index,
				sender = message.sender,
				timestamp = message.timestamp,
				content = message.content,
				parts = { message },
				raw_digests = { message.raw_digest },
				digest = message.raw_digest
			}
		else
			local key = concat_group_key(message)
			grouped[key] = grouped[key] or {}
			grouped[key][#grouped[key] + 1] = message
		end
	end

	for _, segments in pairs(grouped) do
		table.sort(segments, function(a, b) return a.index < b.index end)
		local candidates = {}
		for _, segment in ipairs(segments) do
			local selected, selected_distance
			for _, candidate in ipairs(candidates) do
				local distance = timestamp_distance(segment.timestamp_epoch, candidate.timestamp_epoch)
				if not candidate.parts[segment.concat.part] and distance <= 600 and
					(not selected or distance < selected_distance) then
					selected, selected_distance = candidate, distance
				end
			end
			if not selected then
				selected = { parts = {}, timestamp_epoch = segment.timestamp_epoch, total = segment.concat.total }
				candidates[#candidates + 1] = selected
			end
			selected.parts[segment.concat.part] = segment
		end

		for _, candidate in ipairs(candidates) do
			local parts, complete = {}, true
			for part = 1, candidate.total do
				if not candidate.parts[part] then
					complete = false
				else
					parts[#parts + 1] = candidate.parts[part]
				end
			end
			if complete then
				logical[#logical + 1] = make_logical_message(parts, identity_prefix)
			else
				incomplete[#incomplete + 1] = parts
			end
		end
	end

	table.sort(logical, function(a, b) return a.index < b.index end)
	return logical, incomplete
end

local function utf8_to_utf16_units(text)
	local units, index, length = {}, 1, #text
	while index <= length do
		local first = text:byte(index)
		local codepoint, consumed
		if first < 0x80 then
			codepoint, consumed = first, 1
		elseif first >= 0xC2 and first <= 0xDF and index + 1 <= length then
			local second = text:byte(index + 1)
			if second >= 0x80 and second <= 0xBF then
				codepoint, consumed = (first - 0xC0) * 0x40 + second - 0x80, 2
			end
		elseif first >= 0xE0 and first <= 0xEF and index + 2 <= length then
			local second, third = text:byte(index + 1), text:byte(index + 2)
			if second >= 0x80 and second <= 0xBF and third >= 0x80 and third <= 0xBF and
				not (first == 0xE0 and second < 0xA0) and not (first == 0xED and second >= 0xA0) then
				codepoint = (first - 0xE0) * 0x1000 + (second - 0x80) * 0x40 + third - 0x80
				consumed = 3
			end
		elseif first >= 0xF0 and first <= 0xF4 and index + 3 <= length then
			local second, third, fourth = text:byte(index + 1), text:byte(index + 2), text:byte(index + 3)
			if second >= 0x80 and second <= 0xBF and third >= 0x80 and third <= 0xBF and
				fourth >= 0x80 and fourth <= 0xBF and not (first == 0xF0 and second < 0x90) and
				not (first == 0xF4 and second >= 0x90) then
				codepoint = (first - 0xF0) * 0x40000 + (second - 0x80) * 0x1000 +
					(third - 0x80) * 0x40 + fourth - 0x80
				consumed = 4
			end
		end
		if not codepoint then
			codepoint, consumed = 0xFFFD, 1
		end
		index = index + consumed
		if codepoint <= 0xFFFF then
			units[#units + 1] = codepoint
		else
			codepoint = codepoint - 0x10000
			units[#units + 1] = 0xD800 + math.floor(codepoint / 0x400)
			units[#units + 1] = 0xDC00 + codepoint % 0x400
		end
	end
	return units
end

local function hex_byte(value)
	return string.format("%02X", value % 256)
end

local function hex_word(value)
	return string.format("%04X", value % 65536)
end

local function encode_address(number)
	local international = number:sub(1, 1) == "+"
	local digits = number:gsub("^%+", "")
	local padded = #digits % 2 == 1 and (digits .. "F") or digits
	local encoded = {}
	for index = 1, #padded, 2 do
		encoded[#encoded + 1] = padded:sub(index + 1, index + 1) .. padded:sub(index, index)
	end
	return #digits, international and "91" or "81", table.concat(encoded)
end

local function split_utf16_units(units, limit)
	local chunks, position = {}, 1
	while position <= #units do
		local finish = math.min(#units, position + limit - 1)
		if finish < #units and units[finish] >= 0xD800 and units[finish] <= 0xDBFF then
			finish = finish - 1
		end
		if finish < position then finish = math.min(#units, position + 1) end
		local chunk = {}
		for index = position, finish do chunk[#chunk + 1] = units[index] end
		chunks[#chunks + 1] = chunk
		position = finish + 1
	end
	return chunks
end

local function generate_submit_pdus(number, text, reference)
	local address_length, address_type, address = encode_address(number)
	local units = utf8_to_utf16_units(text)
	local chunks
	if #units <= 70 then
		chunks = split_utf16_units(units, 70)
	else
		chunks = split_utf16_units(units, 66)
	end
	if #chunks == 0 then chunks = { {} } end
	if #chunks > 255 then return nil, "forwarded message exceeds 255 SMS parts" end
	reference = tonumber(reference) or 0
	local pdus = {}
	for sequence, chunk in ipairs(chunks) do
		local multipart = #chunks > 1
		local udh = multipart and ("060804" .. hex_word(reference) .. hex_byte(#chunks) .. hex_byte(sequence)) or ""
		local encoded = {}
		for _, unit in ipairs(chunk) do encoded[#encoded + 1] = hex_word(unit) end
		local user_data = udh .. table.concat(encoded)
		local first_octet = multipart and "41" or "01"
		pdus[#pdus + 1] = "00" .. first_octet .. "00" .. hex_byte(address_length) ..
			address_type .. address .. "00" .. "08" .. hex_byte(#user_data / 2) .. user_data
	end
	return pdus
end

local function format_forward_text(message)
	return table.concat({
		FORWARD_MARKER,
		"From: " .. (message.sender ~= "" and message.sender or "Unknown"),
		"Time: " .. (message.timestamp ~= "" and message.timestamp or "Unknown"),
		"",
		message.content or ""
	}, "\n")
end

local function same_phone_number(left, right)
	left = tostring(left or ""):gsub("%D", "")
	right = tostring(right or ""):gsub("%D", "")
	if left == "" or right == "" then return false end
	if left == right then return true end
	return #left >= 10 and #right >= 10 and left:sub(-10) == right:sub(-10)
end

local function send_pdu(pdu, storage)
	local output, ok = run_capture(shell_quote(SEND_HELPER) .. " --sync " .. shell_quote(pdu) .. " " .. shell_quote(storage))
	if not ok or has_at_error(output) or not tostring(output or ""):match("SMS PDU sent successfully") then
		return nil, trim(output or "SMS send failed"):sub(1, 300)
	end
	return true
end

local function record_forwarded_message(message, recipient, text, parts, sent_at)
	local command = table.concat({
		shell_quote(OUTBOX_HELPER),
		"add",
		shell_quote("forward-" .. message.digest),
		"forward",
		shell_quote(tostring(sent_at)),
		shell_quote(base64_encode(recipient)),
		shell_quote(base64_encode(text)),
		shell_quote(tostring(parts))
	}, " ")
	local output, ok = run_capture(command)
	if not ok then
		local reason = trim(output)
		if reason == "" then reason = "outbox helper failed" end
		return nil, reason:sub(1, 300)
	end
	return true
end

local function message_has_done_part(state, message)
	for _, digest in ipairs(message.raw_digests) do
		if digest and state.done[digest] then return true end
	end
	return false
end

local function mark_message_done(state, message)
	mark_done(state, message.digest)
	for _, digest in ipairs(message.raw_digests) do mark_done(state, digest) end
	state.progress[message.digest] = nil
end

local function notify_command(message)
	local sender = trim(message.sender or ""):gsub("[%c]+", " "):sub(1, 40)
	if sender == "" then sender = "unknown sender" end
	local content = trim(message.content or ""):gsub("[%c]+", " "):sub(1, 400)
	return shell_quote(NOTIFY_HELPER) .. " event sms " .. shell_quote("SMS from " .. sender) .. " " ..
		shell_quote(content) .. " >/dev/null 2>&1 &"
end

local notified = {}

local function notify_message(message)
	if notified[message.digest] then return end
	notified[message.digest] = true
	if command_succeeded(os.execute("[ -x " .. shell_quote(NOTIFY_HELPER) .. " ]")) then
		os.execute(notify_command(message))
	end
end

local function forward_message(state, message, config)
	if not message.digest then return nil, "failed to fingerprint SMS" end
	if message.content == "" then
		mark_message_done(state, message)
		return true, "skipped-empty"
	end
	if message.content:sub(1, #FORWARD_MARKER) == FORWARD_MARKER then
		mark_message_done(state, message)
		return true, "skipped-loop"
	end
	if same_phone_number(message.sender, config.number) then
		mark_message_done(state, message)
		return true, "skipped-loop"
	end

	-- Announce the new message once, then (only when forwarding is on) pass it on by SMS.
	notify_message(message)
	if not config.enabled then
		mark_message_done(state, message)
		return true, "notified"
	end

	local text = format_forward_text(message)
	local reference = tonumber(message.digest:sub(1, 4), 16) or 0
	local pdus, encode_error = generate_submit_pdus(config.number, text, reference)
	if not pdus then return nil, encode_error end
	local progress = state.progress[message.digest]
	if not progress or progress.total ~= #pdus or progress.target ~= config.number then
		progress = { next_part = 1, total = #pdus, target = config.number, timestamp = os.time() }
		state.progress[message.digest] = progress
		if not save_state(state) then return nil, "failed to save SMS forwarding progress" end
	end

	for part = progress.next_part, #pdus do
		runtime.STATE = "forwarding"
		runtime.LAST_ERROR = ""
		save_runtime()
		local ok, send_error = send_pdu(pdus[part], config.storage)
		if not ok then
			return nil, "part " .. tostring(part) .. "/" .. tostring(#pdus) .. ": " .. tostring(send_error)
		end
		progress.next_part = part + 1
		progress.timestamp = os.time()
		if not save_state(state) then return nil, "failed to save SMS forwarding progress" end
	end

	local outbox_ok, outbox_error = record_forwarded_message(
		message, config.number, text, #pdus, progress.timestamp or os.time())
	if not outbox_ok then
		return nil, "failed to record forwarded SMS in outbox: " .. tostring(outbox_error)
	end

	mark_message_done(state, message)
	if not save_state(state) then return nil, "failed to save completed SMS state" end
	runtime.LAST_FORWARD = tostring(os.time())
	runtime.FORWARDED_COUNT = tostring((tonumber(runtime.FORWARDED_COUNT) or 0) + 1)
	log("info", "forwarded SMS from " .. mask_number(message.sender) .. " in " .. tostring(#pdus) .. " part(s)")
	return true, "forwarded"
end

local state = load_state()
local last_scan_monotonic = 0

local function monotonic_time()
	local ok, socket = pcall(require, "socket")
	if ok and socket and socket.gettime then return socket.gettime() end
	return os.time()
end

local function scan(force)
	local current_time = monotonic_time()
	if not force and current_time - last_scan_monotonic < 2 then return true end
	last_scan_monotonic = current_time

	local config = read_config()
	runtime.STORAGE = config.storage
	runtime.TARGET = mask_number(config.number)
	if not config.enabled and not config.notify then
		if state.initialized or next(state.progress) then
			state.initialized = false
			state.progress = {}
			save_state(state)
		end
		runtime.STATE = "disabled"
		runtime.LAST_ERROR = ""
		save_runtime()
		return true, "disabled"
	end
	if config.enabled and not config.number then
		set_error("SMS forwarding number is invalid")
		return nil
	end
	runtime.STATE = "scanning"
	runtime.LAST_SCAN = tostring(os.time())
	save_runtime()

	local sim_value, _, identity_error = query_sim_identity(config.storage)
	if not sim_value then
		set_error(identity_error or "Unable to read SIM identity")
		return nil
	end
	local sim_identity = sha256("sim\0" .. sim_value)
	if not sim_identity then
		set_error("Unable to hash SIM identity")
		return nil
	end
	if state.identity ~= sim_identity or state.storage ~= config.storage then
		reset_state_identity(state, sim_identity, config.storage)
	end

	local output, inbox_error = run_at(config.storage, "AT+CMGL=4")
	if not output then
		set_error(inbox_error or "Unable to read SMS inbox")
		return nil
	end

	local identity_prefix = sim_identity .. "\0" .. config.storage
	local messages, ignored, entries = parse_inbox(output, identity_prefix)
	local logical, incomplete = assemble_messages(messages, identity_prefix)
	local keep = {}
	for _, entry in ipairs(entries) do if entry.raw_digest then keep[entry.raw_digest] = true end end
	for _, message in ipairs(logical) do if message.digest then keep[message.digest] = true end end

	if not state.initialized then
		for _, entry in ipairs(entries) do if entry.raw_digest then mark_done(state, entry.raw_digest) end end
		for _, message in ipairs(logical) do if message.digest then mark_done(state, message.digest) end end
		state.initialized = true
		prune_done(state, keep)
		if not save_state(state) then
			set_error("Unable to save initial SMS forwarding baseline")
			return nil
		end
		runtime.STATE = "idle"
		runtime.PENDING_COUNT = tostring(#incomplete)
		runtime.SKIPPED_COUNT = tostring(#ignored)
		runtime.LAST_ERROR = ""
		save_runtime()
		log("info", "initialized SMS forwarding baseline with " .. tostring(#entries) .. " stored PDU(s)")
		return true, "baseline"
	end

	local changed = false
	local skipped = 0
	for _, item in ipairs(ignored) do
		if item.digest and not state.done[item.digest] then
			mark_done(state, item.digest)
			changed = true
			skipped = skipped + 1
			log("warning", "skipped unsupported stored PDU: " .. tostring(item.reason or "parse error"))
		end
	end

	for _, parts in ipairs(incomplete) do
		local baseline_part = false
		for _, part in ipairs(parts) do
			if part.raw_digest and state.done[part.raw_digest] then baseline_part = true end
		end
		if baseline_part then
			for _, part in ipairs(parts) do
				if part.raw_digest and not state.done[part.raw_digest] then
					mark_done(state, part.raw_digest)
					changed = true
				end
			end
		end
	end

	for _, message in ipairs(logical) do
		if message.digest and not state.done[message.digest] then
			if message_has_done_part(state, message) then
				mark_message_done(state, message)
				changed = true
			else
				local ok, result = forward_message(state, message, config)
				if not ok then
					set_error(result or "SMS forwarding failed")
					return nil
				end
				if result ~= "forwarded" then skipped = skipped + 1 end
				changed = true
			end
		end
	end

	prune_done(state, keep)
	if changed and not save_state(state) then
		set_error("Unable to save SMS forwarding state")
		return nil
	end
	runtime.STATE = "idle"
	runtime.PENDING_COUNT = tostring(#incomplete)
	runtime.SKIPPED_COUNT = tostring(skipped)
	runtime.LAST_ERROR = ""
	save_runtime()
	return true
end

local function selftest_assert(condition, message)
	if not condition then error("selftest: " .. message, 0) end
end

local function encode_numeric_address(number)
	local length, toa, encoded = encode_address(number)
	return hex_byte(length) .. toa .. encoded
end

local function encode_test_timestamp()
	return "62217021436500"
end

local function make_test_deliver(number, text, concat)
	local units = utf8_to_utf16_units(text)
	local udh = ""
	local first = "00"
	if concat then
		first = "40"
		udh = "060804" .. hex_word(concat.reference) .. hex_byte(concat.total) .. hex_byte(concat.part)
	end
	local body = {}
	for _, unit in ipairs(units) do body[#body + 1] = hex_word(unit) end
	local user_data = udh .. table.concat(body)
	return "00" .. first .. encode_numeric_address(number) .. "00" .. "08" .. encode_test_timestamp() ..
		hex_byte(#user_data / 2) .. user_data
end

local function make_test_gsm7_deliver(number, values, concat)
	local user_data = {}
	local first = "00"
	local header_septets = 0
	if concat then
		first = "40"
		user_data = { 0x05, 0x00, 0x03, concat.reference % 256, concat.total, concat.part }
		header_septets = math.ceil(#user_data * 8 / 7)
	end
	local bit_offset = header_septets * 7
	for value_index, value in ipairs(values) do
		for bit = 0, 6 do
			if math.floor(value / (2 ^ bit)) % 2 == 1 then
				local position = bit_offset + (value_index - 1) * 7 + bit
				local byte_index = math.floor(position / 8) + 1
				user_data[byte_index] = (user_data[byte_index] or 0) + 2 ^ (position % 8)
			end
		end
	end
	local encoded = {}
	for _, byte in ipairs(user_data) do encoded[#encoded + 1] = hex_byte(byte) end
	local udl = header_septets + #values
	return "00" .. first .. encode_numeric_address(number) .. "00" .. "00" .. encode_test_timestamp() ..
		hex_byte(udl) .. table.concat(encoded)
end

local function run_selftest()
	selftest_assert(base64_encode("") == "", "base64 empty input")
	selftest_assert(base64_encode("f") == "Zg==", "base64 one-byte input")
	selftest_assert(base64_encode("fo") == "Zm8=", "base64 two-byte input")
	selftest_assert(base64_encode("foo") == "Zm9v", "base64 three-byte input")
	selftest_assert(base64_encode("SMS \228\184\173") == "U01TIOS4rQ==", "base64 UTF-8 input")

	local single = make_test_deliver("+8613800000000", "hello " .. utf8_char(0x4E2D), nil)
	local parsed = assert(parse_pdu(single, 7))
	selftest_assert(parsed.sender == "+8613800000000", "numeric sender")
	selftest_assert(parsed.content == "hello " .. utf8_char(0x4E2D), "UCS2 decode")
	local gsm7 = assert(parse_pdu(make_test_gsm7_deliver("+8613800000000", { 0x48, 0x45, 0x4C, 0x4C, 0x4F }), 8))
	selftest_assert(gsm7.content == "HELLO", "GSM7 packed decode")
	local gsm7_concat = assert(parse_pdu(make_test_gsm7_deliver("+8613800000000",
		{ 0x41, 0x1B, 0x14 }, { reference = 23, total = 2, part = 1 }), 9))
	selftest_assert(gsm7_concat.content == "A^" and gsm7_concat.concat.reference == 23,
		"GSM7 UDH fill bits and extension decode")

	local one = assert(parse_pdu(make_test_deliver("+8613800000000", "part-one", { reference = 0x1234, total = 2, part = 1 }), 10))
	local two = assert(parse_pdu(make_test_deliver("+8613800000000", "part-two", { reference = 0x1234, total = 2, part = 2 }), 11))
	one.raw_digest, two.raw_digest = sha256(one.raw), sha256(two.raw)
	local complete, pending = assemble_messages({ two, one }, "test")
	selftest_assert(#complete == 1 and #pending == 0, "out-of-order multipart assembly")
	selftest_assert(complete[1].content == "part-onepart-two", "multipart content")
	local incomplete = select(2, assemble_messages({ one }, "test"))
	selftest_assert(#incomplete == 1, "incomplete multipart held")

	local seventy = string.rep("A", 70)
	local pdus = assert(generate_submit_pdus("+8613900000000", seventy, 1))
	selftest_assert(#pdus == 1, "70 UCS2 units fit one SMS")
	pdus = assert(generate_submit_pdus("+8613900000000", seventy .. "B", 0xBEEF))
	selftest_assert(#pdus == 2 and pdus[1]:match("060804BEEF0201"), "16-bit multipart UDH")
	local emoji = utf8_char(0x1F600)
	pdus = assert(generate_submit_pdus("+8613900000000", string.rep("A", 65) .. emoji .. string.rep("Z", 5), 2))
	selftest_assert(#pdus == 2, "surrogate-aware split")
	selftest_assert(not pdus[1]:match("D83D$"), "surrogate pair not split")

	local extension = decode_gsm7_values({ 0x41, 0x1B, 0x14, 0x1B, 0x65 })
	selftest_assert(extension == "A^" .. utf8_char(0x20AC), "GSM7 extension table")

	local command = notify_command({ sender = "+60123456789", content = "Code 1234\nit's 'secret'" })
	selftest_assert(command:find(" event sms ", 1, true) and not command:find("\n", 1, true), "notify command is one line")
	selftest_assert(command:find("'\\''", 1, true), "notify text is shell quoted")
	selftest_assert(command:match("&$") ~= nil, "notify runs in the background")
	print("sms-forward selftest: OK")
end

local function main_loop()
	load_runtime()
	local function safe_scan(force)
		local ok, err = pcall(scan, force)
		if not ok then set_error("Unhandled SMS forwarding error: " .. tostring(err)) end
	end

	safe_scan(true)
	local have_uloop, uloop = pcall(require, "uloop")
	local have_ubus, ubus = pcall(require, "ubus")
	if not have_uloop or not uloop then
		log("warning", "Lua uloop module unavailable; using 20 second polling")
		while true do
			sleep_seconds(POLL_INTERVAL)
			safe_scan(true)
		end
	end

	uloop.init()
	local poll_timer
	poll_timer = uloop.timer(function()
		safe_scan(true)
		poll_timer:set(POLL_INTERVAL * 1000)
	end, POLL_INTERVAL * 1000)
	local event_timer = uloop.timer(function()
		safe_scan(true)
	end)

	local connection
	local subscribe_timer
	local subscribed = false
	local connection_needs_reset = false
	local function close_connection()
		if connection then pcall(function() connection:close() end) end
		connection = nil
		subscribed = false
	end

	local function subscribe()
		if not have_ubus or not ubus then return end
		if subscribed then return end
		if connection_needs_reset then
			close_connection()
			connection_needs_reset = false
		end
		if not connection then connection = ubus.connect() end
		if not connection then
			log("warning", "unable to connect to ubus; callback retry scheduled")
			subscribe_timer:set(POLL_INTERVAL * 1000)
			return
		end

		local subscriber = {
			notify = function()
				event_timer:set(250)
			end,
			remove = function()
				subscribed = false
				connection_needs_reset = true
				subscribe_timer:set(1000)
			end
		}
		local ok, err = pcall(function() connection:subscribe(UBUS_OBJECT, subscriber) end)
		if ok then
			subscribed = true
			log("info", "subscribed to " .. UBUS_OBJECT)
		else
			close_connection()
			log("warning", "SMS callback unavailable; retrying while polling: " .. tostring(err))
			subscribe_timer:set(POLL_INTERVAL * 1000)
		end
	end

	subscribe_timer = uloop.timer(subscribe)
	if have_ubus and ubus then
		subscribe_timer:set(1)
	else
		log("warning", "Lua ubus module unavailable; using timer reconciliation only")
	end
	uloop.run()
	close_connection()
end

local mode = arg and arg[1] or nil
if mode == "--selftest" then
	run_selftest()
elseif mode == "--decode" then
	local message, err = parse_pdu(arg[2] or "", tonumber(arg[3]) or 0)
	if not message then
		io.stderr:write(tostring(err), "\n")
		os.exit(1)
	end
	print("SENDER=" .. message.sender)
	print("TIME=" .. message.timestamp)
	print("CONTENT=" .. message.content:gsub("\n", "\\n"))
	if message.concat then
		print(string.format("CONCAT=%d/%d REF=%d WIDTH=%d", message.concat.part, message.concat.total,
			message.concat.reference, message.concat.width))
	end
elseif mode == "--encode" then
	local number = normalize_number(arg[2])
	if not number then io.stderr:write("invalid phone number\n"); os.exit(1) end
	local pdus, err = generate_submit_pdus(number, arg[3] or "", tonumber(arg[4]) or 1)
	if not pdus then io.stderr:write(tostring(err), "\n"); os.exit(1) end
	for _, pdu in ipairs(pdus) do print(pdu) end
elseif mode == "--once" then
	load_runtime()
	local ok = scan(true)
	os.exit(ok and 0 or 1)
elseif mode == "--disable" then
	load_runtime()
	state.initialized = false
	state.progress = {}
	if not save_state(state) then
		io.stderr:write("failed to save disabled SMS forwarding state\n")
		os.exit(1)
	end
	runtime.STATE = "disabled"
	runtime.LAST_ERROR = ""
	runtime.PENDING_COUNT = "0"
	runtime.TARGET = ""
	save_runtime()
else
	main_loop()
end
