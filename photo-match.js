/* Inventory photo similarity v2: colour, local colour placement, brightness
   patterns and edge structure. Deterministic browser-side suggestions only:
   not a trained AI classifier and does not claim a true probability. */
(function(root){
  'use strict';
  const normalise=a=>{const n=Math.hypot(...a);return a.map(v=>n?v/n:0)};
  function describe(data,width,height){
    const colour=Array(64).fill(0),grid=Array(64).fill(0),counts=Array(64).fill(0),
      spatial=Array(48).fill(0),spatialCounts=Array(16).fill(0),edge=Array(8).fill(0),gray=[];
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const p=(y*width+x)*4,r=data[p],g=data[p+1],b=data[p+2],v=.299*r+.587*g+.114*b;
      gray[y*width+x]=v;
      colour[(r>>6)*16+(g>>6)*4+(b>>6)]++;
      const cell=Math.min(7,Math.floor(y*8/height))*8+Math.min(7,Math.floor(x*8/width));
      grid[cell]+=v;counts[cell]++;
      const cell4=Math.min(3,Math.floor(y*4/height))*4+Math.min(3,Math.floor(x*4/width));
      spatial[cell4*3]+=r;spatial[cell4*3+1]+=g;spatial[cell4*3+2]+=b;spatialCounts[cell4]++;
    }
    for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
      const p=y*width+x,dx=gray[p+1]-gray[p-1],dy=gray[p+width]-gray[p-width];
      const angle=(Math.atan2(dy,dx)+Math.PI)%Math.PI;
      edge[Math.min(7,Math.floor(angle*8/Math.PI))]+=Math.hypot(dx,dy);
    }
    const cells=grid.map((v,i)=>v/(counts[i]||1)),mean=cells.reduce((a,b)=>a+b,0)/64;
    return {
      colour:colour.map(v=>v/(width*height)),
      grid:normalise(cells.map(v=>v-mean)),
      edge:normalise(edge),
      spatial:spatial.map((v,i)=>v/(255*(spatialCounts[Math.floor(i/3)]||1)))
    };
  }
  function rotateGrid(grid,size){
    return grid.map((_,i)=>grid[(size-1-i%size)*size+Math.floor(i/size)]);
  }
  function rotateRGB(rgb){
    return rgb.map((_,i)=>{
      const cell=Math.floor(i/3),channel=i%3;
      const source=(3-cell%4)*4+Math.floor(cell/4);
      return rgb[source*3+channel];
    });
  }
  function similarity(a,b){
    if(!a?.colour||!b?.colour||!a?.grid||!b?.grid||!a?.edge||!b?.edge)return 0;
    const colour=Math.max(0,Math.min(1,a.colour.reduce((n,v,i)=>n+Math.min(v,b.colour[i]||0),0)));
    let grid=b.grid,best=-1;
    for(let k=0;k<4;k++){
      best=Math.max(best,a.grid.reduce((n,v,i)=>n+v*(grid[i]||0),0));
      grid=rotateGrid(grid,8);
    }
    const edge=Math.max(0,Math.min(1,a.edge.reduce((n,v,i)=>n+v*(b.edge[i]||0),0)));
    let spatial=0;
    if(Array.isArray(a.spatial)&&Array.isArray(b.spatial)&&a.spatial.length===48&&b.spatial.length===48){
      let target=b.spatial,distance=Infinity;
      for(let k=0;k<4;k++){
        let sum=0;
        for(let i=0;i<48;i++)sum+=Math.abs(a.spatial[i]-target[i]);
        distance=Math.min(distance,sum/48);
        target=rotateRGB(target);
      }
      // Spatial colour reduces false matches between objects with similar
      // overall colours but different colour placement.
      spatial=Math.exp(-3.3*distance);
    }
    return Math.max(0,Math.min(1,.27*colour+.31*Math.max(0,best)+.11*edge+.31*spatial));
  }
  async function fromBlob(blob){
    let bitmap;
    try{
      bitmap=await createImageBitmap(blob);
      const c=document.createElement('canvas');c.width=c.height=96;
      const ctx=c.getContext('2d',{willReadFrequently:true});
      ctx.drawImage(bitmap,0,0,96,96);
      return describe(ctx.getImageData(0,0,96,96).data,96,96);
    }finally{bitmap?.close?.()}
  }
  const api={version:2,describe,similarity,fromBlob};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.InventoryPhotoMatch=api;
})(typeof window==='object'?window:globalThis);
