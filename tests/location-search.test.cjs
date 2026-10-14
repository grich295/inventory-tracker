const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync('inventory-tracker/app.js','utf8');
const fn=src.slice(src.indexOf('  function filteredItems()'),src.indexOf('  function itemsHtml()'));
const S={search:'',categoryFilter:'',locationFilter:'Store',showArchived:false,locations:[{id:'1',location_name:'Store'},{id:'2',location_name:'Store Annex'}],items:[{id:'a',active:true,name:'Bolts'},{id:'b',active:true,name:'Nuts'},{id:'c',active:true,name:'Empty'}]};
const positions={a:[{location_id:'1',quantity:3}],b:[{location_id:'2',quantity:5}],c:[{location_id:'1',quantity:0}]};
const ctx={S,num:Number,byId:(arr,id)=>arr.find(x=>x.id===id),itemPositions:id=>positions[id],locationLabel:x=>x.location_name};vm.createContext(ctx);vm.runInContext(fn+';out=filteredItems()',ctx);
assert.deepEqual(Array.from(ctx.out,x=>x.id),['a']);S.search='nuts';vm.runInContext('out=filteredItems()',ctx);assert.equal(ctx.out.length,0);S.locationFilter='';vm.runInContext('out=filteredItems()',ctx);assert.equal(ctx.out[0].id,'b');
console.log('Exact location and positive-stock filtering intersects item search; all-location reset works.');
