// 配置ボードの Service Worker
// 方針: ネットワーク優先。つながるときは常に最新を取得してキャッシュを更新し、
// つながらないときだけキャッシュから返す（更新後に古い版が出続けることがない）。
// ファイル構成を変えたときは CACHE_VERSION を上げると、古いキャッシュが削除される。
var CACHE_VERSION = "v1";
var CACHE_PREFIX = "placement-board-";
var CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;

// 必須ファイル（1つでも取れなければインストール失敗 = 中途半端なキャッシュを作らない）
var CORE_FILES = ["./", "./index.html", "./qrcode.js"];
// あれば入れるファイル（なくてもインストールは続ける）
var OPTIONAL_FILES = ["./manifest.json", "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", function(event){
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.addAll(CORE_FILES).then(function(){
        return Promise.all(OPTIONAL_FILES.map(function(url){
          return cache.add(url).catch(function(){});
        }));
      });
    }).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(key){
        if(key.indexOf(CACHE_PREFIX) === 0 && key !== CACHE_NAME) return caches.delete(key);
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

// 電波が弱く応答が返ってこないときに待ち続けないよう、画面の取得は一定時間で諦めてキャッシュを使う
var NAVIGATION_TIMEOUT_MS = 4000;

function fetchWithTimeout(request, ms){
  return new Promise(function(resolve, reject){
    var timer = setTimeout(function(){ reject(new Error("timeout")); }, ms);
    fetch(request).then(function(res){ clearTimeout(timer); resolve(res); },
                        function(err){ clearTimeout(timer); reject(err); });
  });
}

self.addEventListener("fetch", function(event){
  var req = event.request;
  if(req.method !== "GET") return;
  var url = new URL(req.url);
  if(url.origin !== self.location.origin) return;   // 外部へのリクエストには関与しない

  var isNavigation = req.mode === "navigate";
  var network = isNavigation ? fetchWithTimeout(req, NAVIGATION_TIMEOUT_MS) : fetch(req);

  event.respondWith(
    network.then(function(res){
      if(res && res.ok && res.type === "basic"){
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function(cache){ cache.put(req, copy); });
      }
      return res;
    }).catch(function(){
      return caches.match(req, { ignoreSearch: isNavigation }).then(function(hit){
        if(hit) return hit;
        // 画面の読み込みなら、URLが違っても（?付き、/ と /index.html など）アプリ本体を返す
        if(isNavigation){
          return caches.match("./index.html").then(function(page){ return page || caches.match("./"); });
        }
        return Response.error();
      });
    })
  );
});
