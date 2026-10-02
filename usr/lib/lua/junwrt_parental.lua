-- Pure policy functions shared by the CLI and the policy tests.
local M = {}
M.resolvers = { child = '185.228.168.168', teen = '185.228.168.10', none = false }

function M.minutes(value)
    if type(value) ~= 'string' then return nil end
    local h, m = value:match('^(%d%d):(%d%d)$')
    h, m = tonumber(h), tonumber(m)
    if not h or h > 23 or m > 59 then return nil end
    return h * 60 + m
end

function M.validate(p)
    if type(p) ~= 'table' then return nil, 'Invalid profile.' end
    local mac = type(p.mac) == 'string' and p.mac:upper() or ''
    if not mac:match('^%x%x:%x%x:%x%x:%x%x:%x%x:%x%x$') or
        tonumber(mac:sub(1, 2), 16) % 2 ~= 0 or mac == '00:00:00:00:00:00' then
        return nil, 'Enter a unicast device MAC address.'
    end
    if type(p.name) ~= 'string' or #p.name < 1 or #p.name > 64 or p.name:find('%c') then
        return nil, 'Enter a device name (1–64 characters).'
    end
    if p.level ~= 'child' and p.level ~= 'teen' and p.level ~= 'none' then
        return nil, 'Choose a supported filter level.'
    end
    if p.enabled ~= '0' and p.enabled ~= '1' then return nil, 'Invalid enable setting.' end
    if p.schedule ~= '0' and p.schedule ~= '1' then return nil, 'Invalid schedule setting.' end
    if type(p.days) ~= 'string' or not p.days:match('^[0-6]+$') or #p.days > 7 then
        return nil, 'Select at least one day.'
    end
    local seen = {}
    for d in p.days:gmatch('.') do
        if seen[d] then return nil, 'Duplicate schedule day.' end
        seen[d] = true
    end
    if not M.minutes(p.start) or not M.minutes(p.finish) or p.start == p.finish then
        return nil, 'Enter different start and end times; disable the schedule for all-day access.'
    end
    return { mac = mac, name = p.name, level = p.level, enabled = p.enabled,
        schedule = p.schedule, days = p.days, start = p.start, finish = p.finish,
        id = 'pc' .. mac:gsub(':', ''):lower() }
end

function M.allowed(p, day, minute, clock_ok)
    if p.enabled ~= '1' or p.schedule ~= '1' then return true end
    if not clock_ok then return false end
    local start, finish = M.minutes(p.start), M.minutes(p.finish)
    if start < finish then
        return p.days:find(tostring(day), 1, true) ~= nil and minute >= start and minute < finish
    end
    -- Selected day is the day the overnight window starts.
    return (minute >= start and p.days:find(tostring(day), 1, true) ~= nil) or
        (minute < finish and p.days:find(tostring((day + 6) % 7), 1, true) ~= nil)
end

function M.rules(profiles)
    local v4, v6, input4, input6, dns = {}, {}, {}, {}, {}
    for _, p in ipairs(profiles) do
        if p.enabled == '1' then
            local match = '-m mac --mac-source ' .. p.mac
            if not p.allowed then
                v4[#v4 + 1] = match .. ' -j DROP'
                v6[#v6 + 1] = match .. ' -j DROP'
                -- Keep DHCP, router DNS and LuCI reachable, but block local proxies.
                for _, rules in ipairs({ input4, input6 }) do
                    rules[#rules + 1] = match .. ' -p udp -m multiport --dports 53,67,68,546,547 -j RETURN'
                    rules[#rules + 1] = match .. ' -p tcp -m multiport --dports 53,80,443 -j RETURN'
                    rules[#rules + 1] = match .. ' -j DROP'
                end
            elseif M.resolvers[p.level] then
                -- IPv6 is disabled only for filtered clients; IPv4 remains available.
                v6[#v6 + 1] = match .. ' -j DROP'
                for _, proto in ipairs({ 'tcp', 'udp' }) do
                    v4[#v4 + 1] = match .. ' -p ' .. proto .. ' --dport 853 -j DROP'
                    dns[#dns + 1] = match .. ' -p ' .. proto .. ' --dport 53 -j DNAT --to-destination ' .. M.resolvers[p.level] .. ':53'
                end
            end
        end
    end
    local function filter(forward, input)
        local out = { '*filter', ':JUN_PC_F - [0:0]', ':JUN_PC_I - [0:0]', '-F JUN_PC_F', '-F JUN_PC_I',
            '-A JUN_PC_F -o br-lan -j RETURN' }
        for _, r in ipairs(forward) do out[#out + 1] = '-A JUN_PC_F ' .. r end
        for _, r in ipairs(input) do out[#out + 1] = '-A JUN_PC_I ' .. r end
        out[#out + 1] = 'COMMIT'
        return table.concat(out, '\n') .. '\n'
    end
    local nat = { '*nat', ':JUN_PC_DNS - [0:0]', '-F JUN_PC_DNS' }
    for _, r in ipairs(dns) do nat[#nat + 1] = '-A JUN_PC_DNS ' .. r end
    nat[#nat + 1] = 'COMMIT'
    return filter(v4, input4), filter(v6, input6), table.concat(nat, '\n') .. '\n'
end
return M
