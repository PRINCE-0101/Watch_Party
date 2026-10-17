import {test} from 'node:test';
import assert from 'node:assert/strict';
import {targetPosition,correction,distance} from '../dist/sync.js';
test('late joins extrapolate a playing authoritative timeline',()=>assert.equal(targetPosition({position:20,playing:true},1000,3500),22.5));
test('paused playback never advances',()=>assert.equal(targetPosition({position:20,playing:false},1000,3500),20));
test('large drift requires seeking; small drift uses gentle rate correction',()=>{assert.equal(correction(10,11).seek,true);assert.equal(correction(10,10.2).rate,1.04);assert.equal(correction(10.2,10).rate,.96);assert.equal(correction(10,10.01).rate,1);});
test('fuzzy matching tolerates a typo',()=>assert.equal(distance('sintle','sintel'),2));
