// Pure PV calculations. Power is W, positive grid = import, positive battery = discharge.
export const DEFAULTS={title:'PV-Anlage',solar:'sensor.inverter_power',grid:'sensor.inverter_grid_power',home:'sensor.inverter_load_power',battery:'sensor.inverter_battery_power',soc:'sensor.inverter_battery',grid_positive:'import',battery_positive:'discharge',animated:true};
export const FIELDS={solar:['PV-Leistung','power'],grid:['Netzleistung','power'],home:['Hausverbrauch','power'],battery:['Batterieleistung','power'],soc:['Batterie-Ladezustand','soc'],solar_energy:['PV-Ertrag','energy'],import_energy:['Netzbezug','energy'],export_energy:['Einspeisung','energy'],home_energy:['Hausverbrauch','energy'],charge_energy:['Batterie geladen','energy'],discharge_energy:['Batterie entladen','energy']};
export function numeric(value){if(value===null||value===undefined||String(value).trim()==='')return null;const n=Number(value);return Number.isFinite(n)?n:null;}
export function powerValue(state){const n=numeric(state?.state),factor={W:1,kW:1000,MW:1e6}[state?.attributes?.unit_of_measurement];return n===null||!factor?null:n*factor;}
export function liveValues(states,config){const v={};for(const key of ['solar','grid','home','battery'])v[key]=powerValue(states[config[key]]);if(config.grid_positive==='export'&&v.grid!==null)v.grid*=-1;if(config.battery_positive==='charge'&&v.battery!==null)v.battery*=-1;v.soc=numeric(states[config.soc]?.state);if(v.soc!==null&&(v.soc<0||v.soc>100))v.soc=null;return v;}
export function allocateFlows(v,hasBattery=true){
  const {solar,grid,home}=v,battery=hasBattery?v.battery:0;
  if([solar,grid,home,battery].some(x=>x===null||!Number.isFinite(x)))return {flows:[],difference:null};
  const pv=Math.max(0,solar),load=Math.max(0,home),charge=Math.max(0,-battery),discharge=Math.max(0,battery),imports=Math.max(0,grid),exports=Math.max(0,-grid);
  const pvHome=Math.min(pv,load),pvBattery=Math.min(Math.max(0,pv-pvHome),charge),pvGrid=Math.min(Math.max(0,pv-pvHome-pvBattery),exports);
  const batteryHome=Math.min(discharge,Math.max(0,load-pvHome)),gridHome=Math.min(imports,Math.max(0,load-pvHome-batteryHome)),gridBattery=Math.min(Math.max(0,imports-gridHome),Math.max(0,charge-pvBattery));
  return {flows:[['solar','home',pvHome,'solar'],['solar','battery',pvBattery,'charge'],['solar','grid',pvGrid,'export'],['battery','home',batteryHome,'battery'],['grid','home',gridHome,'grid'],['grid','battery',gridBattery,'grid']].filter(x=>x[2]>0).map(([from,to,value,role])=>({from,to,value,role})),difference:pv+imports+discharge-load-charge-exports};
}
export function dayKey(date,timeZone){return new Intl.DateTimeFormat('sv-SE',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
function addDays(key,days){const d=new Date(key+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
export function midnight(key,timeZone){const desired=Date.parse(key+'T00:00:00Z');let t=desired;for(let i=0;i<4;i++){const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(t));const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));const actual=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);t+=desired-actual;}return t;}
export function periodRange(period,anchor,timeZone){let first=anchor,last;if(period==='week'){const dow=new Date(anchor+'T12:00:00Z').getUTCDay();first=addDays(anchor,-((dow+6)%7));last=addDays(first,7);}else if(period==='month'){first=anchor.slice(0,7)+'-01';const d=new Date(first+'T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);last=d.toISOString().slice(0,10);}else if(period==='year'){first=anchor.slice(0,4)+'-01-01';last=(Number(first.slice(0,4))+1)+'-01-01';}else last=addDays(first,1);return {first,last,start:midnight(first,timeZone),end:midnight(last,timeZone)};}
export function shiftAnchor(period,anchor,direction){const d=new Date(anchor+'T12:00:00Z');if(period==='year'){d.setUTCMonth(0,1);d.setUTCFullYear(d.getUTCFullYear()+direction);}else if(period==='month'){d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+direction);}else d.setUTCDate(d.getUTCDate()+direction*(period==='week'?7:1));return d.toISOString().slice(0,10);}
export const HISTORY_INTERVALS = {
  day: {recorder: '5minute', label: '15-Minuten-Werte'},
  week: {recorder: 'day', label: 'Tageswerte'},
  month: {recorder: 'day', label: 'Tageswerte'},
  year: {recorder: 'month', label: 'Monatswerte'},
};

function statisticTimestamp(value) {
  const timestamp = numeric(value);
  if (timestamp === null) return NaN;
  return timestamp < 1e12 ? timestamp * 1000 : timestamp;
}

export function chartPoints(rows,{start,end,step,sign=1,field='mean',now=Date.now()}){
  const buckets=new Map();for(const row of rows||[]){const x=statisticTimestamp(row.start);const value=numeric(row[field]);if(value===null||!Number.isFinite(x)||x<start||x>=end)continue;const key=start+Math.floor((x-start)/step)*step;const endTime=statisticTimestamp(row.end);const weight=Number.isFinite(endTime)?Math.max(1,Math.min(endTime,end)-x):1;const b=buckets.get(key)||{sum:0,weight:0};b.sum+=value*sign*(field==='change'?1:weight);b.weight+=field==='change'?1:weight;buckets.set(key,b);}
  const result=[];for(let x=start;x<Math.min(end,now);x+=step){const b=buckets.get(x);result.push({x,y:b?(field==='change'?b.sum:b.sum/b.weight):null});}return result;
}

/** Calendar bucket starts in the configured Home Assistant time zone. */
export function calendarBuckets(period, range, timeZone, now = Date.now()) {
  const buckets = [];
  for (let key = range.first; key < range.last; ) {
    const start = midnight(key, timeZone);
    if (start >= now) break;
    buckets.push(start);
    key = period === 'year' ? shiftAnchor('month', key, 1) : addDays(key, 1);
  }
  return buckets;
}

export function historyPoints(rows, {period, range, buckets, field = 'mean', sign = 1, now = Date.now()}) {
  if (period === 'day') {
    return chartPoints(rows, {
      start: range.start,
      end: Math.min(range.end, now),
      step: 15 * 60 * 1000,
      field,
      sign,
      now,
    });
  }
  // The recorder already reduced these rows to local days or months.
  const values = new Map((rows || []).map(row => [statisticTimestamp(row.start), numeric(row[field])]));
  return buckets.map(x => {
    const value = values.get(x) ?? null;
    return {x, y: value === null ? null : value * sign};
  });
}
