// Mock of the claude.ai runtime used by the survey: db (with editor/respondent rules), user, downloads.
// The store lives in the test runner (exposed functions __dbget/__dbput); role comes from localStorage "__role".
(function(){
  var role = localStorage.getItem("__role") || "editor";       // "editor" | "resp" | "none"
  if (role === "none") return;
  var uidv = localStorage.getItem("__uid") || (role === "editor" ? "u_editor" : "u_resp");
  // Store lives in the test runner (exposed function), so it survives reloads reliably.
  var cache = {};
  function load(){ return cache; }
  function save(st){ cache = st; window.__dbput(JSON.stringify(st)); }
  window.__mockReady = window.__dbget().then(function(t){ cache = JSON.parse(t || "{}"); });
  var listeners = [];
  window.__writes = 0;
  function canRead(path){ return role === "editor" || path === "responses/" + uidv; }
  function canWrite(path){ return role === "editor" || path === "responses/" + uidv; }
  function snapDoc(path, st){ var exists = Object.prototype.hasOwnProperty.call(st, path) && canRead(path);
    return {id: path.split("/").pop(), exists: exists, data: function(){ return exists ? JSON.parse(JSON.stringify(st[path])) : undefined; }, metadata:{fromCache:false, hasPendingWrites:false}}; }
  function notify(){ var st = load(); listeners.forEach(function(l){ l.fire(st); }); }
  function docRef(path){
    if (path.split("/").length % 2) throw new TypeError("doc path parity");
    return {
      id: path.split("/").pop(), path: path,
      get: function(){ return window.__mockReady.then(function(){ return snapDoc(path, load()); }); },
      set: function(data){ return window.__mockReady.then(function(){ return setNow(data); }); function setNow(data){
        if (!canWrite(path)) return Promise.reject({code:"invalid_argument", message:"rule"});
        if (localStorage.getItem("__failwrites") === "1") return Promise.reject({code:"unavailable", message:"down"});
        var st = load(); st[path] = JSON.parse(JSON.stringify(data)); save(st); window.__writes++; setTimeout(notify, 5); return Promise.resolve();
      } },
      delete: function(){
        if (!canWrite(path)) return Promise.reject({code:"invalid_argument", message:"rule"});
        var st = load(); delete st[path]; save(st); setTimeout(notify, 5); return Promise.resolve();
      }
    };
  }
  function collRef(path){
    return {
      path: path,
      doc: function(id){ return docRef(path + "/" + (id || Math.random().toString(36).slice(2))); },
      onSnapshot: function(next, err){
        var l = {fire: function(st){
          var docs = Object.keys(st).filter(function(k){ return k.indexOf(path + "/") === 0 && k.split("/").length === path.split("/").length + 1 && canRead(k); }).sort().map(function(k){ return snapDoc(k, st); });
          next({docs: docs, size: docs.length, empty: !docs.length, docChanges: function(){ return []; }, metadata:{fromCache:false, hasPendingWrites:false}});
        }};
        listeners.push(l); window.__mockReady.then(function(){ setTimeout(function(){ l.fire(load()); }, 5); });
        return function(){ listeners = listeners.filter(function(x){ return x !== l; }); };
      }
    };
  }
  var db = {doc: docRef, collection: collRef};
  var user = {
    id: function(){ return Promise.resolve(uidv); },
    isOwner: function(){ return Promise.resolve(role === "editor"); },
    canEdit: function(){ return Promise.resolve(role === "editor"); },
    can: function(){ return Promise.resolve(null); }
  };
  window.__downloads = [];
  var downloads = {save: function(r){ window.__downloads.push(r); return Promise.resolve({status:"saved"}); }};
  window.claude = {use: function(name){
    return new Promise(function(res){ setTimeout(function(){ res(name === "db" ? db : name === "user" ? user : name === "downloads" ? downloads : null); }, 30); });
  }};
})();
