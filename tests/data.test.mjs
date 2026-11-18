import {test} from 'node:test';
import assert from 'node:assert/strict';
import {numeric,powerValue,liveValues,allocateFlows,periodRange,historyRange,validCustomRange,shiftAnchor,chartPoints,calendarBuckets,historyPoints,energyFromPower} from '../custom_components/pv_manager/frontend/data.js';
test('unavailable measurements and units never become zero',()=>{for(const v of [null,undefined,'','unknown','unavailable','NaN','Infinity'])assert.equal(numeric(v),null);assert.equal(powerValue({state:'2.5',attributes:{unit_of_measurement:'kW'}}),2500);assert.equal(powerValue({state:'50',attributes:{unit_of_measurement:'%'}}),null);});
test('signed powers, SOC limits and directed flows',()=>{const state=(state,unit='W')=>({state:String(state),attributes:{unit_of_measurement:unit}});const v=liveValues({s:state(5000),g:state(1000),h:state(2500),b:state(1500),soc:state(65,'%')},{solar:'s',grid:'g',home:'h',battery:'b',soc:'soc',grid_positive:'export',battery_positive:'charge'});assert.deepEqual(v,{solar:5000,grid:-1000,home:2500,battery:-1500,soc:65});const a=allocateFlows(v);assert.equal(a.difference,0);assert.equal(a.flows.find(f=>f.to==='battery').value,1500);assert.equal(a.flows.find(f=>f.to==='grid').value,1000);assert.equal(allocateFlows({...v,grid:null}).flows.length,0);assert.equal(allocateFlows({solar:0,grid:750,home:750,battery:null},false).difference,0);});
test('DST uses local calendar boundaries and month navigation clamps day',()=>{const spring=periodRange('day','2026-03-29','Europe/Berlin'),autumn=periodRange('day','2026-10-25','Europe/Berlin');assert.equal((spring.end-spring.start)/3600000,23);assert.equal((autumn.end-autumn.start)/3600000,25);assert.equal(shiftAnchor('month','2026-01-31',1),'2026-02-01');assert.equal(periodRange('week','2026-11-17','Europe/Berlin').first,'2026-11-16');});
test('statistic aggregation is duration weighted and missing intervals stay null',()=>{const rows=[{start:1000,end:1010,mean:100},{start:1010,end:1030,mean:400},{start:1060,end:1070,mean:null}];const p=chartPoints(rows,{start:1000000,end:1120000,step:60000,now:2000000});assert.equal(p[0].y,300);assert.equal(p[1].y,null);assert.equal(chartPoints([{start:1000,end:1010,change:2},{start:1010,end:1020,change:3}],{start:1000000,end:1060000,step:60000,field:'change',now:2000000})[0].y,5);});

test('quarter hours average measurements, sum energy and preserve gaps on a DST day', () => {
  const range = periodRange('day', '2026-10-25', 'Europe/Berlin');
  const rows = [100, 250, 400].map((mean, i) => ({
    start: range.start + i * 300000,
    end: range.start + (i + 1) * 300000,
    mean, change: i + 1,
  }));
  const options = {period: 'day', range, now: range.end};
  const power = historyPoints(rows, {...options, sign: -1});
  const energy = historyPoints(rows, {...options, field: 'change'});
  assert.equal(power.length, 100);
  assert.deepEqual(power.slice(0, 2), [{x: range.start, y: -250}, {x: range.start + 900000, y: null}]);
  assert.equal(energy[0].y, 6);
  assert.equal(energy[1].y, null);
});

test('daily and monthly series keep local calendar boundaries and missing intervals', () => {
  const timezone = 'Europe/Berlin';
  const range = periodRange('week', '2026-03-29', timezone);
  const buckets = calendarBuckets('week', range, timezone, range.end);
  assert.equal(buckets.length, 7);
  assert.equal(new Date(buckets.at(-1)).toISOString(), '2026-03-28T23:00:00.000Z');
  const power = historyPoints([{start: buckets[0], mean: 120}, {start: range.end, mean: 500}], {
    period: 'week', range, buckets, sign: -1,
  });
  assert.deepEqual(power.map(point => point.y), [-120, null, null, null, null, null, null]);
  const year = periodRange('year', '2026-06-15', timezone);
  const months = calendarBuckets('year', year, timezone, year.end);
  assert.equal(months.length, 12);
  assert.equal(new Date(months[3]).toISOString(), '2026-03-31T22:00:00.000Z');
  const energy = historyPoints([{start: months[3] / 1000, change: 123}], {
    period: 'year', range: year, buckets: months, field: 'change',
  });
  assert.deepEqual(energy[3], {x: months[3], y: 123});
  assert.equal(energy[4].y, null);
});

test('power estimates sum energy on real overlap, apply the grid direction and retain gaps', () => {
  const start = Date.parse('2026-10-25T00:00Z');
  const quarter = 900000;
  const buckets = [start, start + quarter, start + 2 * quarter, start + 3 * quarter];
  const rows = [
    {start: start + 600000, end: start + 1200000, mean: -1200},
    {start: start + 1200000, end: start + 1800000, mean: 2000},
    {start: start + 1800000, end: start + 2700000, mean: null},
    {start: start + 2700000, end: start + 3600000, mean: -4000},
  ];
  const end = start + 3000000;
  const points = energyFromPower(rows, {buckets, end, sign: -1});
  assert.deepEqual(points.map(point => point.y), [0.1, 0.1, null, 1/3]);
});

test('current views roll and previous selections represent full local calendar periods', () => {
  const tz = 'Europe/Berlin';
  const now = Date.parse('2026-11-18T05:40Z');
  const day = historyRange('day', null, tz, now);
  assert.equal(day.start, Date.parse('2026-11-17T05:40Z'));
  assert.equal(day.end, now);
  const yesterday = historyRange('day', '2026-11-17', tz, now);
  assert.equal(yesterday.start, Date.parse('2026-11-16T23:00Z'));
  assert.equal(yesterday.end, Date.parse('2026-11-17T23:00Z'));
  const week = historyRange('week', null, tz, now);
  assert.equal(week.first, '2026-11-11');
  assert.equal(calendarBuckets('week', week, tz, now).length, 8);
  const previousWeek = historyRange('week', '2026-11-11', tz, now);
  assert.equal(previousWeek.first, '2026-11-09');
  assert.equal(previousWeek.last, '2026-11-16');
  assert.equal(calendarBuckets('week', previousWeek, tz, now).length, 7);
  assert.equal(historyRange('month', null, tz, now).first, '2026-11-01');
});

test('custom selections include the end date and reject invalid or oversized ranges', () => {
  const now = Date.parse('2026-11-18T05:40Z');
  const dates = ['2026-03-28', '2026-03-30'];
  const custom = historyRange('custom', null, 'Europe/Berlin', now, dates);
  assert.equal(custom.last, '2026-03-31');
  assert.equal((custom.end - custom.start) / 3600000, 71);
  assert.ok(validCustomRange(...dates, '2026-11-18'));
  assert.ok(!validCustomRange('2026-02-30', '2026-03-01', '2026-11-18'));
  assert.ok(!validCustomRange('2025-11-17', '2026-11-18', '2026-11-18'));
  assert.ok(!validCustomRange('2026-11-18', '2026-11-19', '2026-11-18'));
});
