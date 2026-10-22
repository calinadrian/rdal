// Complete recipe snapshots from ProgressComponent, scoped to the current character/session.
window.RecipeKnowledge=(()=>{
  let saved=Preferences.json('recipeProgressSnapshot',null);
  let current=saved, known=Array.isArray(saved?.recipes) ? new Set(saved.recipes) : null;
  let connected=false,confirmed=false;
  const validIds=ids=>Array.isArray(ids)&&ids.length<=20000&&ids.every(id=>typeof id==='string'&&id.length>0&&id.length<256);
  function connection(value) {
    if(connected===value)return false;
    connected=value;
    confirmed=false;
    current=value ? null : saved;
    known=validIds(current?.recipes) ? new Set(current.recipes) : null;
    return true;
  }
  return {
    connection,
    waiting(){if(!connected || !current)return false;current=null;known=null;confirmed=false;return true;},
    ingest(data){
      if(!data || !/^[\da-f]{32}$/i.test(data.character || ''))return false;
      const same=current?.character===data.character && current?.session===data.session;
      const valid=validIds(data.recipes);
      const ids=valid ? [...new Set(data.recipes)].sort() : same ? current.recipes : null;
      const changed=!same || JSON.stringify(ids)!==JSON.stringify(current?.recipes);
      current={character:data.character,session:data.session,recipes:ids,at:Date.now()};
      confirmed=valid;
      known=validIds(ids) ? new Set(ids) : null;
      if((valid && changed) || saved?.character!==data.character){
        saved=current;Preferences.setJSON('recipeProgressSnapshot',saved);
      }
      return changed;
    },
    status(id){return !known ? 'unknown' : known.has(id) ? 'learned' : 'not-learned';},
    summary(){return {character:current?.character || null,known:!!known,count:known?.size ?? null,
      live:connected&&!!known&&confirmed,at:current?.at || null};},
  };
})();
