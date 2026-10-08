// Startpage: Weather widget (Open-Meteo).
// Classic script sharing globals with the others; load order is set in index.html.

// ── Weather widget (Open-Meteo — free, no API key, CORS-enabled) ───────────────
const WEATHER_REFRESH_MS = 30 * 60 * 1000;  // 30 min
let weatherTimer   = null;
let weatherLastSig = '';     // lat,lon,units of the last fetch
let weatherData    = null;   // last good payload, kept so lang/units changes re-render instantly
// Map a WMO weather code to an emoji + an index into L().weatherConds
function weatherInfo(code) {
  const c = Number(code);
  if (c === 0) return { idx: 0,  icon: '☀️' };
  if (c === 1) return { idx: 1,  icon: '🌤️' };
  if (c === 2) return { idx: 2,  icon: '⛅' };
  if (c === 3) return { idx: 3,  icon: '☁️' };
  if (c === 45 || c === 48)       return { idx: 4,  icon: '🌫️' };
  if (c >= 51 && c <= 55)         return { idx: 5,  icon: '🌦️' };
  if (c === 56 || c === 57)       return { idx: 5,  icon: '🌧️' };
  if (c >= 61 && c <= 65)         return { idx: 6,  icon: '🌧️' };
  if (c === 66 || c === 67)       return { idx: 7,  icon: '🌧️' };
  if (c >= 71 && c <= 75)         return { idx: 8,  icon: '🌨️' };
  if (c === 77)                   return { idx: 9,  icon: '🌨️' };
  if (c >= 80 && c <= 82)         return { idx: 10, icon: '🌦️' };
  if (c === 85 || c === 86)       return { idx: 11, icon: '🌨️' };
  if (c === 95)                   return { idx: 12, icon: '⛈️' };
  if (c === 96 || c === 99)       return { idx: 13, icon: '⛈️' };
  return { idx: 3, icon: '☁️' };
}
function showWeatherState(key) {
  $.weatherBody.innerHTML = `<div class="weather-state">${esc(L()[key] || '')}</div>`;
  scheduleLayout();
}
function applyWeather() {
  const w = settings.weather;
  ALL_POSITIONS.forEach(p => $.weatherPanel.classList.remove('pos-' + p));
  $.weatherPanel.classList.add('pos-' + (ALL_POSITIONS.includes(w.position) ? w.position : 'tr'));
  if (weatherTimer) { clearInterval(weatherTimer); weatherTimer = null; }
  if (!w.enabled) { $.weatherPanel.classList.remove('show'); scheduleLayout(); return; }
  $.weatherPanel.classList.add('show');
  if (!w.location) { weatherData = null; showWeatherState('weatherSetLocation'); return; }
  const sig = w.location.lat + ',' + w.location.lon + ',' + w.units;
  if (sig !== weatherLastSig) fetchWeather();
  else renderWeather();
  weatherTimer = setInterval(fetchWeather, WEATHER_REFRESH_MS);
  scheduleLayout();
}
async function fetchWeather() {
  const w = settings.weather;
  if (!w.location) { showWeatherState('weatherSetLocation'); return; }
  const sig = w.location.lat + ',' + w.location.lon + ',' + w.units;
  weatherLastSig = sig;
  if (!weatherData) showWeatherState('weatherLoading');
  const unit = w.units === 'f' ? 'fahrenheit' : 'celsius';
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${w.location.lat}&longitude=${w.location.lon}` +
              `&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=auto&temperature_unit=${unit}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('weather http');
    const data = await res.json();
    if (sig !== weatherLastSig) return;  // settings changed mid-flight, abandon
    if (!data.current || typeof data.current.temperature_2m !== 'number') throw new Error('bad weather');
    weatherData = {
      temp:  Math.round(data.current.temperature_2m),
      code:  data.current.weather_code,
      hi:    data.daily ? Math.round(data.daily.temperature_2m_max[0]) : null,
      lo:    data.daily ? Math.round(data.daily.temperature_2m_min[0]) : null,
      units: w.units,
      name:  w.location.name,
    };
    renderWeather();
  } catch {
    if (sig !== weatherLastSig) return;
    if (!weatherData) showWeatherState('weatherError');
  }
}
function renderWeather() {
  if (!settings.weather.enabled) return;
  if (!weatherData) { if (!settings.weather.location) showWeatherState('weatherSetLocation'); return; }
  const t    = L();
  const info = weatherInfo(weatherData.code);
  const deg  = weatherData.units === 'f' ? '°F' : '°C';
  const cond = t.weatherConds[info.idx] || '';
  const loc  = settings.weather.location;
  const name = weatherData.name || (loc ? `${loc.lat.toFixed(2)}, ${loc.lon.toFixed(2)}` : '');
  let html =
    `<div class="weather-main">` +
      `<div class="weather-icon">${info.icon}</div>` +
      `<div class="weather-meta">` +
        `<div class="weather-temp">${weatherData.temp}${deg}</div>` +
        `<div class="weather-cond">${esc(cond)}</div>` +
        `<div class="weather-loc" title="${esc(name)}">${esc(name)}</div>` +
      `</div>` +
    `</div>`;
  if (weatherData.hi !== null && weatherData.lo !== null) {
    html += `<div class="weather-hilo">` +
            `<span>${esc(t.weatherHigh)} <b>${weatherData.hi}${deg}</b></span>` +
            `<span>${esc(t.weatherLow)} <b>${weatherData.lo}${deg}</b></span></div>`;
  }
  $.weatherBody.innerHTML = html;
  scheduleLayout();
}
async function geocodeCity(name) {
  const lang = settings.lang === 'da' ? 'da' : 'en';
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=${lang}&format=json`);
  if (!res.ok) throw new Error('geocode http');
  const data = await res.json();
  const r = data.results && data.results[0];
  if (!r) return null;
  return { lat: r.latitude, lon: r.longitude, name: [r.name, r.country_code].filter(Boolean).join(', ') };
}
async function setWeatherLocationFromInput() {
  const name = $.setWeatherLoc.value.trim();
  if (!name) return;
  showWeatherState('weatherLoading');
  try {
    const loc = await geocodeCity(name);
    if (!loc) { showWeatherState('weatherCityNotFound'); return; }
    settings.weather.location = loc;
    $.setWeatherLoc.value = loc.name;
    weatherLastSig = '';
    save();
    if (settings.weather.enabled) applyWeather();
  } catch { showWeatherState('weatherError'); }
}
function useMyLocation() {
  if (!navigator.geolocation) { showWeatherState('weatherGeoDenied'); return; }
  showWeatherState('weatherLocating');
  navigator.geolocation.getCurrentPosition(pos => {
    settings.weather.location = {
      lat:  Number(pos.coords.latitude.toFixed(4)),
      lon:  Number(pos.coords.longitude.toFixed(4)),
      name: L().myLocation,
    };
    $.setWeatherLoc.value = settings.weather.location.name;
    weatherLastSig = '';
    save();
    if (settings.weather.enabled) applyWeather();
  }, () => showWeatherState('weatherGeoDenied'));
}
$.weatherRefresh.addEventListener('click', () => {
  if (!settings.weather.location) return;
  $.weatherRefresh.classList.remove('spin');
  void $.weatherRefresh.offsetWidth;   // restart the transition
  $.weatherRefresh.classList.add('spin');
  weatherLastSig = '';
  fetchWeather();
});
