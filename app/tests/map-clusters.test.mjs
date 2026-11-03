import test from 'node:test';
import assert from 'node:assert/strict';
import {clusterPlaces} from '../src/map-clusters.js';
const point=(id,x,icon='circle',priority=0)=>({id,x,y:0,name:id,mark:{icon,color:'blue'},priority});
test('same marks merge first, mixed marks need closer distances, selection stays separate',()=>{
 assert.equal(clusterPlaces([point('a',0),point('b',33)]).length,1);
 assert.equal(clusterPlaces([point('a',0),point('b',33,'triangle')]).length,2);
 assert.equal(clusterPlaces([point('a',0),point('b',23,'triangle')]).length,1);
 assert.equal(clusterPlaces([point('a',0),point('b',1,'circle',1)]).length,2);
});
test('hysteresis retains groups through small zoom changes and labels avoid icons',()=>{
 assert.equal(clusterPlaces([point('a',0),point('b',38)],[['a','b']]).length,1);
 assert.equal(clusterPlaces([point('a',0),point('b',41)],[['a','b']]).length,2);
 const groups=clusterPlaces([point('a',0),point('b',50,'triangle')]);
 assert.equal(groups.find(g=>g.points[0].id==='a').labelSide,'left');
});
