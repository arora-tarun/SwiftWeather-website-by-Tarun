
/**
 * Weather app using Open-Meteo API (free, no API key needed).
 * Docs: https://open-meteo.com/en/docs
 */

// --- Helpers -------------------------------------------------------
const $ = sel => document.querySelector(sel);
const formatDate = ts => new Date(ts * 1000).toLocaleDateString([], {weekday:'short', day:'numeric'});
const formatTime = ts => new Date(ts * 1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});

// Cache (localStorage + memory) ------------------------------------
const mem = new Map();
const now = () => Date.now();
function cacheGet(key){
  if (mem.has(key)) return mem.get(key);
  const raw = localStorage.getItem(key);
  if(!raw) return null;
  try{ const obj = JSON.parse(raw); if(obj.exp > now()){ mem.set(key, obj.val); return obj.val;} }catch{}
  return null;
}
function cacheSet(key,val,ttl){ mem.set(key,val); localStorage.setItem(key,JSON.stringify({val,exp:now()+ttl})); }

async function getJSON(url,key){
  const cached = cacheGet(key);
  if(cached) return {data:cached,cached:true};
  const t0 = performance.now();
  const data = await fetch(url).then(r=>r.json());
  cacheSet(key,data,1000*60*10);
  const t1 = performance.now();
  return {data,cached:false,ms:Math.round(t1-t0)};
}

// API wrappers ------------------------------------------------------
async function geocode(q){
  const key = `geo:${q.toLowerCase()}`;
  const cached = cacheGet(key); if(cached) return cached;
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`;
  const res = await fetch(url).then(r=>r.json());
  const data = res.results || [];
  cacheSet(key,data,1000*60*60*24*30);
  return data;
}

async function forecast(lat,lon,units){
  const key = `meteo:${lat.toFixed(2)},${lon.toFixed(2)}:${units}`;
  return getJSON(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=temperature_2m,precipitation_probability&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_mean,weathercode&forecast_days=7&timezone=auto&temperature_unit=${units==='imperial'?'fahrenheit':'celsius'}`,
    key
  );
}

// UI state ----------------------------------------------------------
const suggest=$("#suggest"), q=$("#q"), unitToggle=$("#unitToggle"), unitText=$("#unitText"), useLocationBtn=$("#useLocation");
const state={units:localStorage.getItem('units')||'metric'};
unitToggle.checked= state.units==='imperial'; unitText.textContent= state.units==='imperial'?'°F':'°C';

function setUnits(units){ state.units=units; localStorage.setItem('units',units); unitText.textContent=units==='imperial'?'°F':'°C'; if(state.lat&&state.lon) loadWeather(state.lat,state.lon); }
unitToggle.addEventListener('change',()=> setUnits(unitToggle.checked?'imperial':'metric'));

// Rendering ---------------------------------------------------------
function showSkeleton(){
  $("#temp").innerHTML=`<div class="skeleton" style="height:64px;width:220px"></div>`;
  $("#meta").innerHTML=`<div class="skeleton" style="height:18px;width:260px"></div>`;
  $("#info").innerHTML=`<div class="skeleton" style="height:18px;width:200px"></div>`;
  $("#daily").innerHTML=Array.from({length:7},()=>`<div class="mini skeleton" style="height:64px"></div>`).join("");
  $("#hourly").innerHTML=Array.from({length:8},()=>`<div class="mini skeleton" style="height:64px"></div>`).join("");
  $("#updated").textContent="Loading…";
}

function renderCurrent(place,d){
  $("#place").textContent=place;
  const t=Math.round(d.current_weather.temperature);
  $("#temp").innerHTML=`${t}°`;
  $("#meta").textContent=`windspeed ${d.current_weather.windspeed} ${state.units==='metric'?'m/s':'mph'} · code ${d.current_weather.weathercode}`;
  $("#icon").src="https://open-meteo.com/images/weather-icons/01d.png";
  $("#icon").alt="Weather";
  $("#info").textContent=`time ${d.current_weather.time}`;
  $("#updated").textContent=`Updated just now`;
}

function miniCard(label,hi,lo,pop){
  return `<div class="mini">
    <div>
      <div>${label}</div>
      <span class="muted">${hi}° / ${lo}° · ${pop}% rain</span>
    </div>
  </div>`;
}
function renderDaily(d){
  const days=d.daily.time.map((dt,i)=> miniCard(
    formatDate(new Date(dt).getTime()/1000),
    d.daily.temperature_2m_max[i],
    d.daily.temperature_2m_min[i],
    d.daily.precipitation_probability_mean[i]
  ));
  $("#daily").innerHTML=days.join("");
}
function renderHourly(d){
  const hours=d.hourly.time.slice(0,24).map((dt,i)=>{
    const t=new Date(dt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    return `<div class="mini">
      <div>
        <div>${t}</div>
        <span class="muted">${d.hourly.temperature_2m[i]}° · ${d.hourly.precipitation_probability[i]}% rain</span>
      </div>
    </div>`;
  });
  $("#hourly").innerHTML=hours.join("");
}

// Load --------------------------------------------------------------
async function loadWeather(lat,lon){
  state.lat=lat; state.lon=lon; showSkeleton();
  const {data,cached,ms}=await forecast(lat,lon,state.units);
  renderCurrent(state.place||`${lat.toFixed(2)}, ${lon.toFixed(2)}`,data);
  renderDaily(data); renderHourly(data);
  $("#perf").textContent=cached?'cached · instant':`network ${ms}ms`;
}

// Search + geocoding ------------------------------------------------
function debounce(fn,wait){ let t; return(...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),wait); }; }
const search=debounce(async text=>{
  if(!text.trim()){ suggest.style.display='none'; return; }
  try{
    const results=await geocode(text);
    if(!Array.isArray(results)||results.length===0){ suggest.style.display='none'; return; }
    suggest.innerHTML=results.map(r=>{
      const name=`${r.name}${r.admin1?", "+r.admin1:""}, ${r.country}`;
      return `<button type="button" data-lat="${r.latitude}" data-lon="${r.longitude}" data-name="${name}">${name}</button>`;
    }).join("");
    suggest.style.display='block';
  }catch{}
},300);
q.addEventListener('input',e=> search(e.target.value));
suggest.addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b) return;
  const lat=parseFloat(b.dataset.lat), lon=parseFloat(b.dataset.lon); const name=b.dataset.name;
  state.place=name; suggest.style.display='none'; q.value=name;
  loadWeather(lat,lon);
});

// Geolocation -------------------------------------------------------
useLocationBtn.addEventListener('click',()=>{
  if(!('geolocation' in navigator)) return alert('Geolocation not supported');
  navigator.geolocation.getCurrentPosition(pos=>{
    const {latitude:lat,longitude:lon}=pos.coords; state.place='Your location';
    loadWeather(lat,lon);
  },err=> alert('Location error: '+err.message), {enableHighAccuracy:false,timeout:8000,maximumAge:600000});
});

// Init --------------------------------------------------------------
(function init(){
  const last=JSON.parse(localStorage.getItem('lastCoords')||'null');
  if(last){ state.place=last.place; loadWeather(last.lat,last.lon); }
  else { state.place='Mumbai, IN'; loadWeather(19.076,72.8777); }
})();
const obs=new MutationObserver(()=>{ if(state.lat&&state.lon){ localStorage.setItem('lastCoords',JSON.stringify({lat:state.lat,lon:state.lon,place:state.place})); } });
obs.observe(document.body,{subtree:true,childList:true});
