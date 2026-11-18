local frame = CreateFrame("Frame")
local bankOpen = false
local pending = false
local loginTime
local teaching = {
    [171]="Alchemy", [164]="Blacksmithing", [333]="Enchanting", [202]="Engineering",
    [182]="Herbalism", [165]="Leatherworking", [186]="Mining", [393]="Skinning", [197]="Tailoring",
}
local function contentID(link)
    if type(link) ~= "string" then return nil end
    return string.match(link, "item:([^|]+)")
end
local function readable(value)
    return not issecretvalue or not issecretvalue(value)
end
local function bagLimit()
    return NUM_TOTAL_EQUIPPED_BAG_SLOTS or NUM_BAG_SLOTS or 4
end
local function inventory(ids, emptyBag)
    local slots = (C_Container and C_Container.GetContainerNumSlots) or GetContainerNumSlots
    local modernInfo = C_Container and C_Container.GetContainerItemInfo
    if not slots or (not modernInfo and not GetContainerItemInfo) then return nil end
    local collected, seen = {}, {}
    for i, bag in ipairs(ids) do
        if not readable(bag) or type(bag) ~= "number" or seen[bag] then return nil end
        seen[bag] = true
        local size = slots(bag)
        if not readable(size) or type(size) ~= "number" or size < 0 or size > 1000 then return nil end
        if size == 0 and (i == 1 or (emptyBag and not emptyBag(i))) then return nil end
        for slot = 1, size do
            local id, count, link, bound
            if modernInfo then
                local info = modernInfo(bag, slot)
                if not readable(info) then return nil end
                local expected
                if C_Container.GetContainerItemID then
                    expected = C_Container.GetContainerItemID(bag, slot)
                    if not readable(expected) then return nil end
                end
                if info then
                    id, count, link, bound = info.itemID, info.stackCount, info.hyperlink, info.isBound
                    if not readable(id) or not id or (expected and expected ~= id) then return nil end
                    if not readable(count) or not readable(link) then return nil end
                    if not readable(bound) then bound = nil end
                elseif expected then return nil end
            else
                local texture, quantity, _, _, _, _, itemLink, _, _, itemID = GetContainerItemInfo(bag, slot)
                if texture and not itemID and not itemLink then return nil end
                id, count, link = itemID or tonumber(string.match(itemLink or "", "item:(%d+)")), quantity, itemLink
            end
            if id then
                if not link or not count or count < 1 then return nil end
                -- Preserve the full observed item string; pricing may be base-ID only.
                local itemString = contentID(link)
                if not itemString then return nil end
                table.insert(collected, {itemId=id, quantity=count, link=itemString,
                    binding=(bound == true and "bound") or (bound == false and "tradeable") or "unknown"})
            end
        end
    end
    return collected
end
local function sampleBank()
    if not bankOpen then return nil end
    local bankType = Enum and Enum.BankType and Enum.BankType.Character
    if bankType and C_Bank and C_Bank.FetchPurchasedBankTabIDs then
        if not C_Bank.CanViewBank or not C_Bank.FetchNumPurchasedBankTabs then return nil end
        local visible = C_Bank.CanViewBank(bankType)
        if not readable(visible) or visible ~= true then return nil end
        local tabs = C_Bank.FetchPurchasedBankTabIDs(bankType)
        local purchased = C_Bank.FetchNumPurchasedBankTabs(bankType)
        if not readable(tabs) or not readable(purchased) or type(tabs) ~= "table" or #tabs ~= purchased then return nil end
        for _,tab in ipairs(tabs) do
            if not readable(tab) or type(tab) ~= "number" or tab <= bagLimit() then return nil end
        end
        return inventory(tabs,function(index)
            if not C_Bank.ShouldUsePlayerBagsInBank or not C_Bank.BankBagTypeAndIDToInvSlot or not GetInventoryItemID then return false end
            local bagMode = C_Bank.ShouldUsePlayerBagsInBank()
            if not readable(bagMode) or not bagMode then return false end
            local raw = C_Bank.BankBagTypeAndIDToInvSlot(bankType,index)
            if not readable(raw) or type(raw) ~= "number" then return false end
            local equipped = GetInventoryItemID("player",raw+1)
            return readable(equipped) and equipped == nil
        end)
    end
    if not GetNumBankSlots then return nil end
    local purchased = GetNumBankSlots()
    if not readable(purchased) or type(purchased) ~= "number" then return nil end
    local ids = {BANK_CONTAINER or -1}
    for index=1,purchased do ids[#ids+1] = bagLimit()+index end
    return inventory(ids,function(index)
        if not BankButtonIDToInvSlotID or not GetInventoryItemID then return false end
        local invSlot = BankButtonIDToInvSlotID(index-1,true)
        if not invSlot then return false end
        local equipped = GetInventoryItemID("player",invSlot)
        return readable(equipped) and equipped == nil
    end)
end
local function sampleProfessions()
    if not GetProfessions or not GetProfessionInfo then return nil end
    local a,b = GetProfessions()
    local result = {}
    for _,index in pairs({a,b}) do
        local name, _, skill, _, _, _, skillID = GetProfessionInfo(index)
        if type(name) ~= "string" or type(skill) ~= "number" then return nil end
        table.insert(result,{name=teaching[skillID] or name,skill=skill})
    end
    -- Some clients return an empty list until profession data is available.
    if #result == 0 then return nil end
    return result
end
local function observe()
    local id = UnitGUID("player")
    if not id then return end
    if GoblinLedgerDB and GoblinLedgerDB.schema ~= 1 then return end
    GoblinLedgerDB = GoblinLedgerDB or {schema=1, characters={}}
    local c = GoblinLedgerDB.characters[id] or {id=id}
    local now = GetServerTime and GetServerTime() or time()
    local _, build, _, toc = GetBuildInfo()
    c.sequence = (c.sequence or 0) + 1
    c.name, c.realm = UnitName("player"), GetRealmName()
    local _, classID = UnitClass("player")
    c.className, c.level, c.xp, c.xpMax = classID, UnitLevel("player"), UnitXP("player"), UnitXPMax("player")
    c.restedXp = GetXPExhaustion()
    c.money, c.lastSeen, c.build, c.interface = GetMoney(), now, tostring(build), toc
    if loginTime then c.lastLogin = loginTime end
    local bagIds = {0}
    for bag=1,bagLimit() do table.insert(bagIds,bag) end
    local bags = inventory(bagIds,function(index)
        local inventorySlot = C_Container and C_Container.ContainerIDToInventoryID or ContainerIDToInventoryID
        if not inventorySlot or not GetInventoryItemID then return false end
        local slot = inventorySlot(index-1)
        if not slot then return false end
        local equipped = GetInventoryItemID("player",slot)
        return readable(equipped) and equipped == nil
    end)
    if bags then c.bags = {at=now,seq=c.sequence,complete=true,items=bags} end
    local bank = sampleBank()
    if bank then c.bank = {at=now,seq=c.sequence,complete=true,items=bank} end
    local professions = sampleProfessions()
    -- A shorter API response may be a partially loaded profession window. Preserve the
    -- previous complete reading and its timestamp until the missing scope is observable.
    if professions and (not c.professions or #professions >= #c.professions.items) then
        c.professions={at=now,seq=c.sequence,complete=true,items=professions}
    end
    GoblinLedgerDB.characters[id] = c
end
local events = {"PLAYER_ENTERING_WORLD","PLAYER_LOGOUT","PLAYER_MONEY","PLAYER_XP_UPDATE",
    "PLAYER_LEVEL_UP","BAG_UPDATE_DELAYED","BANKFRAME_OPENED","BANKFRAME_CLOSED",
    "PLAYERBANKSLOTS_CHANGED","BANK_TABS_CHANGED","SKILL_LINES_CHANGED","GET_ITEM_INFO_RECEIVED","ITEM_DATA_LOAD_RESULT","UPDATE_EXHAUSTION"}
for _,e in ipairs(events) do pcall(frame.RegisterEvent,frame,e) end
frame:SetScript("OnEvent",function(_,e,initial,reload)
    if e == "PLAYER_ENTERING_WORLD" and initial == true and reload ~= true then
        loginTime = GetServerTime and GetServerTime() or time()
    end
    if e == "BANKFRAME_OPENED" then bankOpen=true end
    if e == "BANKFRAME_CLOSED" then bankOpen=false end
    if e == "PLAYER_LOGOUT" then observe(); return end
    if pending then return end
    if C_Timer and C_Timer.After then
        pending=true
        C_Timer.After(0.15,function() pending=false; observe() end)
    else observe() end
end)
