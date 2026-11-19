import {progressionForCharacter} from './progression.mjs';

export function activityAccess(route, actor) {
  const skill = actor.professions?.find(p => p.name.toLowerCase()===route.profession?.toLowerCase())?.skill;
  if (route.profession && !Number.isInteger(skill)) {
    if (actor.professionsAt == null) return {state:'check',reason:'Check '+route.profession+' '+route.skill+'. Professions have not been observed.'};
    return {state:'unlock',reason:'Requires '+route.profession+' '+route.skill+'. '+actor.name+' has no recorded '+route.profession+'.'};
  }
  if (route.profession && skill < route.skill) {
    const shortfall=route.skill-skill;
    return {state:'unlock',reason:route.profession+' '+skill+' of '+route.skill+'. Gain '+shortfall+' skill '+(shortfall===1?'point.':'points.'),shortfall};
  }
  const skillEvidence = route.profession ? route.profession+' '+skill+' meets '+route.skill+'. ' : '';
  if (route.mobLevels) {
    const [low,high]=route.mobLevels;
    const level=actor.level;
    const reason='Guide lists level '+low+'–'+high+' enemies. '+actor.name+' is level '+level+'.';
    return {state:!Number.isInteger(level) || level<low ? 'check' : 'available',reason};
  }
  if (route.accessCheck) {
    return {state:route.actorId===actor.id && route.sampleScope==='Selected character' && route.runCount>0 ? 'available':'check',
      reason:skillEvidence+route.accessCheck};
  }
  return {state:'available',reason:skillEvidence.trim() || 'No gathering profession required.'};
}

export function characterActivities(actor,routes) {
  const activities=routes.map(route => {
    const access=activityAccess(route,actor);
    const measured=route.yieldBasis==='Personal runs' && route.sampleScope==='Selected character';
    const comparable=access.state==='available' && measured && route.sessionGoldCopper!=null;
    let category;
    if (access.state==='unlock') category='unlock';
    else if (access.state==='check') category='check';
    else if (comparable && route.loops>0 && route.sessionGoldCopper>0) category='ranked';
    else if (comparable) category='low-return';
    else category='lead';
    return {routeId:route.id,site:route.name,zone:route.zone,itemId:route.outputId,item:route.output,
      title:(route.verb ?? 'Gather')+' '+route.output+' at '+route.name,
      notes:route.notes,source:route.source,evidence:route.evidence,category,access,
      usesProfession:Boolean(route.profession),quote:route.quote ?? null,
      requiredUnitsPerHour:access.state==='available' ? route.requiredUnitsPerHour : null,
      sessionCopper:access.state==='available' ? route.sessionGoldCopper : null,
      loops:access.state==='available' ? route.loops : null,approachMinutes:route.approachMinutes,
      runCount:route.runCount,yieldBasis:route.yieldBasis,sampleScope:route.sampleScope,
      gaps:route.gaps,ownRuns:measured};
  });
  const priorities=['ranked','lead','check','low-return','unlock'];
  activities.sort((a,b) => {
    const group=priorities.indexOf(a.category)-priorities.indexOf(b.category);
    if (group) return group;
    if (a.category==='ranked' || a.category==='low-return') {
      const gain=b.sessionCopper-a.sessionCopper;
      if (gain) return gain;
    }
    const hasQuote = Number(b.quote?.ask!=null)-Number(a.quote?.ask!=null);
    if (hasQuote) return hasQuote;
    // Rising asking prices provide a reason to investigate an unmeasured lead.
    // A zero baseline, an older gap or a different house cannot establish a trend.
    const change = q => q?.priorAsk>0 && q.ask!=null ? (q.ask-q.priorAsk)/q.priorAsk : null;
    const left=change(a.quote), right=change(b.quote);
    const trend = Number(right>0)-Number(left>0) || (right>0 && left>0 ? right-left : 0);
    return trend || Number(b.usesProfession)-Number(a.usesProfession) || a.title.localeCompare(b.title);
  });
  return activities;
}

export function alchemyOpportunity(actor,quote) {
  if (!actor.professions.some(p=>p.name.toLowerCase()==='alchemy')) return null;
  const recipe=progressionForCharacter(actor).recipe;
  return {name:"Mender's Potion",...recipe,quote:quote ?? null,
    vendorSource:"https://warcraft.wiki.gg/wiki/Mender%27s_Potion"};
}
