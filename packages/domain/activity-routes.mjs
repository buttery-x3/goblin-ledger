import {herbalismGuide} from './farms.mjs';

const linenGuide = 'https://bytetavern.com/wow-forever-linen-cloth-farming/';
const clothGuide = 'https://bytetavern.com/wow-forever-cloth-farming/';
const miningGuide = 'https://www.icy-veins.com/wow-forever/mining-leveling-guide';

const clothEvidence = 'Forever guide using Classic camp locations and enemy levels';
const sites = [
  {id:'jangolode-linen', name:'Jangolode Mine', zone:'Westfall', output:'Linen Cloth', outputId:2589,
    verb:'Farm', mobLevels:[11,13], source:linenGuide, evidence:clothEvidence,
    notes:'Defeat Riverpaw gnolls and Defias around the mine in northern Westfall. The nearby flight path serves Alliance players.'},
  {id:'thorn-hill-linen', name:'Thorn Hill', zone:'The Barrens', continent:'Kalimdor', output:'Linen Cloth', outputId:2589,
    verb:'Farm', mobLevels:[10,14], source:linenGuide, evidence:clothEvidence,
    notes:'Look for Razormane quilboars on Thorn Hill, northeast of the Crossroads. The Crossroads flight path serves Horde players.'},
  {id:'mosshide-wool', name:'Mosshide camps', zone:'Wetlands', output:'Wool Cloth', outputId:2592,
    verb:'Farm', mobLevels:[22,27], source:clothGuide, evidence:clothEvidence,
    notes:'Defeat Mosshide gnolls around the Wetlands camp near zone coordinates 35, 30.'},
  {id:'mirror-lake-peacebloom', name:'Mirror Lake', zone:'Elwynn Forest', output:'Peacebloom', outputId:2447,
    verb:'Gather', profession:'Herbalism', skill:1, source:herbalismGuide,
    notes:'From Goldshire, head northwest to Mirror Lake. Check the fields along the west bank and loop back east.'},
  {id:'dun-modr-liferoot', name:'Dun Modr marsh banks', zone:'Wetlands', output:'Liferoot', outputId:3357,
    verb:'Gather', profession:'Herbalism', skill:150, source:herbalismGuide,
    notes:"Follow the road from Whelgar's Excavation toward Dun Modr. Check the marsh banks on the return leg."},
  {id:'fargodeep-copper', name:'Fargodeep Mine', zone:'Elwynn Forest', output:'Copper Ore', outputId:2770,
    verb:'Mine', profession:'Mining', skill:1, source:miningGuide,
    notes:'Head south from Goldshire and mine copper veins in the tunnels. Follow the hills east of the mine on the return trip. Bring a mining pick.'},
];

// These guides establish named localities. The world schematic has no calibrated
// transform for them, and none of the entries provides a measured Forever yield.
export const starterRoutes = sites.map(site => ({
  ...site, revision:1, type:site.profession ? 'Gathering' : 'Mob farm',
  requirements:site.profession ? site.profession+' '+site.skill : 'Combat; no gathering profession',
  evidence:site.evidence ?? 'Forever profession guide', coverage:0, exposure:null,
  geometry:{id:site.id+'-locality',mapId:site.zone,continent:site.continent ?? 'Eastern Kingdoms',
    space:'zone-locality',precision:'Named locality',source:site.source},
}));
