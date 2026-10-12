const CACHE_NAME = "planificador-pro-docente-v4-price-5-20261012";
const APP_SHELL = [
  "./",
  "./index.html",
  "./login.html",
  "./dashboard.html",
  "./proyecto.html",
  "./planificacion-diaria.html",
  "./planificaciones.html",
  "./planes.html",
  "./cuenta.html",
  "./admin.html",
  "./style.css",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/add.png",
  "./js/config.js",
  "./js/supabase-client.js",
  "./js/auth.js",
  "./js/api.js",
  "./js/toast.js",
  "./js/theme.js",
  "./js/membresias.js",
  "./js/proyecto.js",
  "./js/planificacion.js",
  "./js/admin.js",
  "./js/dashboard.js",
  "./data/guias.js",
  "./data/guias_ciencias.js",
  "./data/guias_matematica.js",
  "./data/guias_identidad.js",
  "./data/guias_lenguaje.js",
  "./js/guia_ciencias_naturales.js",
  "./js/guia_matematicas.js",
  "./js/guia_identidad.js",
  "./js/guia_lenguaje.js"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copia = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copia));
          return response;
        })
        .catch(() => caches.match(request).then(cached => cached || caches.match("./index.html")))
    );
    return;
  }

  const recursoCritico = request.destination === "script" ||
    request.destination === "style" ||
    url.pathname.endsWith("manifest.json");

  if (recursoCritico) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copia = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copia));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      const actualizacion = fetch(request).then(response => {
        if (response.ok) {
          const copia = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copia));
        }
        return response;
      });
      return cached || actualizacion;
    })
  );
});
