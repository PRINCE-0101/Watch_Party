export function targetPosition(playback, serverTime, estimatedServerNow) {
  return Math.max(0, playback.position + (playback.playing ? Math.max(0, estimatedServerNow - serverTime) / 1000 : 0));
}
export function correction(actual, target) {
  const drift = target - actual;
  return {drift, seek: Math.abs(drift) > 0.35, rate: Math.abs(drift) > 0.08 ? (drift > 0 ? 1.04 : 0.96) : 1};
}
export function distance(a,b) {
  let row=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++) {let next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(a[i-1]===b[j-1]?0:1));row=next;}return row[b.length];
}
