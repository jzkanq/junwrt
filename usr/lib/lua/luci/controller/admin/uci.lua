-- Copyright 2008 Steven Barth <steven@midlink.org>
-- Copyright 2010-2019 Jo-Philipp Wich <jo@mein.io>
-- Licensed to the public under the Apache License 2.0.

module("luci.controller.admin.uci", package.seeall)

local function ubus_state_to_http(errstr)
	local map = {
		["Invalid command"]   = 400,
		["Invalid argument"]  = 400,
		["Method not found"]  = 404,
		["Entry not found"]   = 404,
		["No data"]           = 204,
		["Permission denied"] = 403,
		["Timeout"]           = 504,
		["Not supported"]     = 500,
		["Unknown error"]     = 500,
		["Connection failed"] = 503
	}

	local code = map[errstr] or 200
	local msg  = errstr      or "OK"

	luci.http.status(code, msg)

	if code ~= 204 then
		luci.http.prepare_content("text/plain")
		luci.http.write(msg)
	end
end

local function ipv4(value)
	if type(value) ~= "string" then
		return nil
	end
	local a, b, c, d = value:match("^(%d+)%.(%d+)%.(%d+)%.(%d+)$")
	if a and tonumber(a) > 0 and tonumber(a) < 224 and tonumber(a) ~= 127 and
	   tonumber(b) < 256 and tonumber(c) < 256 and tonumber(d) < 256 then
		return ("%d.%d.%d.%d"):format(a, b, c, d)
	end
end

local function local_address()
	local address = luci.http.getenv("SERVER_ADDR") or ""
	return ipv4(address:gsub("^::[fF][fF][fF][fF]:", ""))
end

local function pending_lan_address(uci)
	local current = local_address()
	if not current or uci:get("network", "lan", "proto") ~= "static" then
		return nil
	end

	local changes = uci:changes("network") or {}
	local changed
	for _, change in ipairs(changes.network or {}) do
		if change[2] == "lan" and change[3] == "ipaddr" then
			changed = true
			break
		end
	end
	if not changed then
		return nil
	end

	local lan = require("luci.util").ubus("network.interface.lan", "status", {}) or {}
	local on_lan
	for _, entry in ipairs(lan["ipv4-address"] or {}) do
		if entry.address == current then
			on_lan = true
			break
		end
	end
	if not on_lan then
		return nil
	end

	local configured = uci:get("network", "lan", "ipaddr")
	local addresses = type(configured) == "table" and configured or { configured }
	local target
	for _, value in ipairs(addresses) do
		local address = type(value) == "string" and ipv4(value:match("^[^/]+"))
		if address == current then
			return nil
		end
		target = target or address
	end
	return target or nil
end

function action_apply_rollback()
	local uci = require "luci.model.uci"
	local address = pending_lan_address(uci)
	local token, errstr, probe = uci:apply(true, address)
	if type(token) == "string" then
		luci.http.header("Cache-Control", "no-store")
		luci.http.prepare_content("application/json")
		luci.http.write_json({ token = token, reconnect_address = address, probe = probe })
	else
		ubus_state_to_http(errstr)
	end
end

function action_apply_unchecked()
	local uci = require "luci.model.uci"
	local _, errstr = uci:apply(false)
	ubus_state_to_http(errstr)
end

function action_confirm()
	local uci = require "luci.model.uci"
	local http = luci.http
	local address = local_address()
	local reconnect = http.formvalue("reconnect")
	if reconnect then
		local pending, _, _, _, target, probe = uci:rollback_pending()
		if not pending or not target or address ~= target or
		   http.getenv("REQUEST_METHOD") ~= "POST" or
		   (reconnect ~= "probe" and reconnect ~= "confirm") then
			return ubus_state_to_http("Permission denied")
		end
		local origin = http.getenv("HTTP_ORIGIN")
		if origin and origin:match("^https?://[%w%.:%[%]%-]+$") then
			http.header("Access-Control-Allow-Origin", origin)
			http.header("Vary", "Origin")
		end
		http.header("Cache-Control", "no-store")
		if reconnect == "probe" then
			http.prepare_content("application/json")
			return http.write_json({ probe = probe })
		end
	end
	local token = http.formvalue("token")
	local _, errstr = uci:confirm(token, reconnect == "confirm" and address or nil)
	ubus_state_to_http(errstr)
end

function action_revert()
	local uci = require "luci.model.uci"
	local changes = uci:changes()

	-- Collect files to be reverted
	local _, errstr, r, tbl
	for r, tbl in pairs(changes) do
		_, errstr = uci:revert(r)
		if errstr then
			break
		end
	end

	ubus_state_to_http(errstr or "OK")
end
