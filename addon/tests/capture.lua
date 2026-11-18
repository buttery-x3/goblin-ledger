-- Run from the repository root with Lua 5.1 or LuaJIT.
local event, now, bagsReady, bankReady = nil,1000,true,true
local bankStack=7
local class,guid="DRUID","fixture-a"
function CreateFrame() return { RegisterEvent=function() end, SetScript=function(_,_,f) event=f end } end
function UnitGUID() return guid end
function UnitName() return guid end
function UnitClass() return class,class end
function GetRealmName() return "Fixture" end
function GetMoney() return 175 end
function GetXPExhaustion() return 50 end
function UnitXP() return 100 end
function UnitXPMax() return 500 end
function UnitLevel() return 24 end
function GetBuildInfo() return "1.60.1","70888","",16001 end
function GetServerTime() return now end
function GetNumBankSlots() return 0 end
function GetProfessions() return 1 end
function GetProfessionInfo() return "Herbalism",nil,155,nil,nil,nil,182 end
function GetInventoryItemID() return nil end
C_Container={ContainerIDToInventoryID=function(bag) return bag+20 end}
function C_Container.GetContainerNumSlots(bag)
    if bag==0 or (bag==-1 and bankReady) then return 1 end
    return 0
end
function C_Container.GetContainerItemInfo(bag)
    if bag==0 then return {itemID=42,stackCount=5,hyperlink=bagsReady and "|Hitem:42:0:0:0:0:0:-3|h[Test]|h" or nil,isBound=false} end
    if bag==-1 and bankStack>0 then return {itemID=55,stackCount=bankStack,hyperlink="|Hitem:55:0:0:0:0:0:0|h[Bank]|h",isBound=true} end
end
dofile("addon/GoblinLedger/GoblinLedger.lua")
local function emit(e,...) now=now+1;event(nil,e,...) end
emit("PLAYER_ENTERING_WORLD",true,false)
local a=GoblinLedgerDB.characters[guid]
assert(a.lastLogin==1001 and a.bank==nil and #a.bags.items==1)
assert(a.bags.items[1].link=="42:0:0:0:0:0:-3" and a.professions.items[1].skill==155)
emit("BANKFRAME_OPENED")
assert(a.bank.complete and a.bank.items[1].quantity==7)
local good=a.bags
bagsReady=false
emit("BAG_UPDATE_DELAYED")
assert(a.bags==good and a.bank.items[1].quantity==7)
bankReady=false;bankStack=0
emit("PLAYERBANKSLOTS_CHANGED")
assert(a.bank.items[1].quantity==7)
emit("BANKFRAME_CLOSED")
bankReady=true
emit("PLAYER_ENTERING_WORLD",false,true)
assert(a.lastLogin==1001 and a.bank.items[1].quantity==7)
emit("BANKFRAME_OPENED")
assert(a.bank.complete and #a.bank.items==0)
emit("BANKFRAME_CLOSED")
guid="fixture-b"; class="MAGE";bagsReady=true
emit("PLAYER_ENTERING_WORLD",true,false)
local b=GoblinLedgerDB.characters[guid]
assert(a.lastLogin~=b.lastLogin and b.bank==nil)
-- The character bank can expose purchased tab container IDs instead of legacy bags.
Enum={BankType={Character=0}}
local tabCount=1
C_Bank={CanViewBank=function() return true end, FetchPurchasedBankTabIDs=function() return {13} end,
    FetchNumPurchasedBankTabs=function() return tabCount end}
local oldSlots=C_Container.GetContainerNumSlots
C_Container.GetContainerNumSlots=function(bag) if bag==13 then return 1 else return oldSlots(bag) end end
local expectID=nil
C_Container.GetContainerItemID=function(bag) if bag==13 then return expectID end end
emit("BANKFRAME_OPENED")
assert(b.bank.complete and #b.bank.items==0)
local last=b.bank
expectID=70
emit("ITEM_DATA_LOAD_RESULT")
assert(b.bank==last)
expectID=nil;tabCount=2
emit("BANK_TABS_CHANGED")
assert(b.bank==last)
print("Addon capture passed: login/reload, two alts, legacy and tabbed banks, delayed item information.")
