/* Inventory photo similarity: deterministic colour, contrast and edge comparisons.
   No trained model, AI service, upload or stock write. */
(function(root){
  'use strict';
  const normalise=a=>{const n=Math.hypot(...a);return a.map(v=>n?v/n:0)};
  function describe(data,width,height){
    const colour=Array(64).fill(0),grid=Array(64).fill(0),counts=Array(64).fill(0),edge=Array(8).fill(0),gray=[];
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const p=(y*width+x)*4,r=data[p],g=data[p+1],b=data[p+2],v=.299*r+.587*g+.114*b;
      gray[y*width+x]=v;colour[(r>>6)*16+(g>>6)*4+(b>>6)]++;
      const cell=Math.min(7,Math.floor(y*8/height))*8+Math.min(7,Math.floor(x*8/width));grid[cell]+=v;counts[cell]++;
    }
    for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
      const p=y*width+x,dx=gray[p+1]-gray[p-1],dy=gray[p+width]-gray[p-width];
      const angle=(Math.atan2(dy,dx)+Math.PI)%Math.PI;
      edge[Math.min(7,Math.floor(angle*8/Math.PI))]+=Math.hypot(dx,dy);
    }
    const cells=grid.map((v,i)=>v/(counts[i]||1)),mean=cells.reduce((a,b)=>a+b,0)/64;
    return {colour:colour.map(v=>v/(width*height)),grid:normalise(cells.map(v=>v-mean)),edge:normalise(edge)};
  }
  function rotate(grid){return grid.map((_,i)=>grid[(7-i%8)*8+Math.floor(i/8)])}
  function similarity(a,b){
    const colour=a.colour.reduce((n,v,i)=>n+Math.min(v,b.colour[i]),0);
    let grid=b.grid,best=-1;
    for(let k=0;k<4;k++){best=Math.max(best,a.grid.reduce((n,v,i)=>n+v*grid[i],0));grid=rotate(grid)}
    const edge=a.edge.reduce((n,v,i)=>n+v*b.edge[i],0);
    return .55*colour+.3*Math.max(0,best)+.15*edge;
  }
  async function fromBlob(blob){
    let bitmap;
    try{
      bitmap=await createImageBitmap(blob);const c=document.createElement('canvas');c.width=c.height=96;
      const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0,96,96);
      return describe(ctx.getImageData(0,0,96,96).data,96,96);
    }finally{bitmap?.close?.()}
  }
  const api={describe,similarity,fromBlob};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.InventoryPhotoMatch=api;
})(typeof window==='object'?window:globalThis);
