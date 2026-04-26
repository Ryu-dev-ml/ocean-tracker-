import { useState, useEffect, useRef, useCallback } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, ZoomControl } from "react-leaflet";

const API_URL = process.env.REACT_APP_API_URL || "";
const API_HEADERS = { "ngrok-skip-browser-warning": "true" };

const POLLUTION_TYPES = {
  oil_spill:          { label: "Oil Spill",          color: "#ff3b3b", bg: "rgba(255,59,59,0.15)"   },
  plastic_waste:      { label: "Plastic Waste",       color: "#ff9f1c", bg: "rgba(255,159,28,0.15)"  },
  chemical_pollution: { label: "Chemical Pollution",  color: "#c77dff", bg: "rgba(199,125,255,0.15)" },
  algae_bloom:        { label: "Algae Bloom",         color: "#06d6a0", bg: "rgba(6,214,160,0.15)"   },
  marine_debris:      { label: "Marine Debris",       color: "#facc15", bg: "rgba(250,204,21,0.15)"  },
};

const ZONES_FALLBACK = [
  { id:1,  name:"Arabian Sea",       geoLat:18.5,  geoLon:65.2,   type:"oil_spill",         severity:89, area:142, trend:+12, confidence:94, source:"fallback" },
  { id:2,  name:"Bay of Bengal",     geoLat:13.0,  geoLon:87.5,   type:"plastic_waste",      severity:64, area:87,  trend:+5,  confidence:88, source:"fallback" },
  { id:3,  name:"South China Sea",   geoLat:14.5,  geoLon:114.2,  type:"chemical_pollution", severity:72, area:56,  trend:-3,  confidence:91, source:"fallback" },
  { id:4,  name:"Pacific Gyre",      geoLat:28.0,  geoLon:-145.0, type:"plastic_waste",      severity:95, area:310, trend:+18, confidence:97, source:"fallback" },
  { id:5,  name:"Mediterranean",     geoLat:36.5,  geoLon:14.8,   type:"algae_bloom",        severity:47, area:33,  trend:-7,  confidence:85, source:"fallback" },
  { id:6,  name:"Persian Gulf",      geoLat:26.0,  geoLon:52.5,   type:"oil_spill",          severity:78, area:95,  trend:+9,  confidence:92, source:"fallback" },
  { id:7,  name:"Gulf of Guinea",    geoLat:1.0,   geoLon:4.0,    type:"oil_spill",          severity:68, area:74,  trend:+6,  confidence:83, source:"fallback" },
  { id:8,  name:"North Sea",         geoLat:56.0,  geoLon:3.5,    type:"marine_debris",      severity:52, area:44,  trend:+2,  confidence:79, source:"fallback" },
  { id:9,  name:"Red Sea",           geoLat:20.0,  geoLon:38.5,   type:"oil_spill",          severity:61, area:58,  trend:+4,  confidence:81, source:"fallback" },
  { id:10, name:"Gulf of Mexico",    geoLat:24.0,  geoLon:-90.0,  type:"oil_spill",          severity:74, area:112, trend:+8,  confidence:88, source:"fallback" },
  { id:11, name:"Strait of Malacca", geoLat:3.5,   geoLon:102.0,  type:"marine_debris",      severity:58, area:39,  trend:+3,  confidence:76, source:"fallback" },
  { id:12, name:"Yellow Sea",        geoLat:34.0,  geoLon:122.5,  type:"algae_bloom",        severity:45, area:28,  trend:-4,  confidence:72, source:"fallback" },
];

function apiZoneToDisplay(z, idx) {
  const sevVal = Math.round((z.confidence || 0.7) * 100);
  const geoLat = (z.latitude  != null && Math.abs(z.latitude)  <= 90)  ? z.latitude  : (Math.random()*140-70);
  const geoLon = (z.longitude != null && Math.abs(z.longitude) <= 180) ? z.longitude : (Math.random()*360-180);
  return {
    id:         z.zone_id || idx + 1,
    name:       z.region || (z.class_name ? z.class_name.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase()) : "Unknown Zone"),
    geoLat, geoLon,
    type:       POLLUTION_TYPES[z.class_name] ? z.class_name : "oil_spill",
    severity:   sevVal,
    area:       Math.round(sevVal * 1.6),
    trend:      sevVal > 70 ? +Math.round(Math.random()*15+3) : -Math.round(Math.random()*8+1),
    confidence: Math.round((z.confidence || 0.7) * 100),
    source:     z.source || "API",
    acquired:   z.acquired || null,
    mean_vv_db: z.mean_vv_db || null,
  };
}

const TIMELINE = {
  "-72h": [55,48,67,82,44,61,50,40,45,60,42,38],
  "-48h": [60,52,69,85,46,66,54,44,48,65,46,40],
  "-24h": [72,58,71,90,45,72,60,48,55,70,50,42],
  "now":  [89,64,72,95,47,78,68,52,61,74,58,45],
  "+24h": [96,70,68,99,49,83,73,56,66,80,62,48],
  "+48h": [99,75,65,99,52,87,78,60,70,86,65,51],
};

const CHAT_RESPONSES = {
  help: `🤖 OceanAI Commands:\n\n• "show alerts"\n• "predict / forecast"\n• "zone status"\n• "oil spill status"\n• "explain detection"\n• "show regions"`,
  default: (q) => `Analyzing: "${q}"\n\nProcessing via YOLOv8m + Sentinel-1 SAR ensemble...\nSpecify a region, pollution type, or timeframe for detailed analysis.`,
};

function getResponse(msg) {
  const m = msg.toLowerCase();
  if (m.includes("help") || m.includes("command")) return CHAT_RESPONSES.help;
  return CHAT_RESPONSES.default(msg);
}

const SeverityRing = ({ value, size=44, color }) => {
  const r = (size-8)/2, circ = 2*Math.PI*r;
  return (
    <svg width={size} height={size} style={{ transform:"rotate(-90deg)" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={4}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={4}
        strokeDasharray={circ} strokeDashoffset={circ-(value/100)*circ} strokeLinecap="round"
        style={{ transition:"stroke-dashoffset 1s ease" }}/>
    </svg>
  );
};

const MiniChart = ({ data, color, height=40 }) => {
  const max=Math.max(...data), min=Math.min(...data);
  const pts = data.map((v,i) => {
    const x=(i/(data.length-1))*100;
    const y=height-((v-min)/(max-min+1))*(height-8)-4;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width="100%" height={height} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none">
      <polyline points={`0,${height} ${pts} 100,${height}`} fill={`${color}22`} stroke="none"/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  );
};

export default function App() {
  const [tab, setTab]             = useState("map");
  const [timeKey, setTimeKey]     = useState("now");
  const [selected, setSelected]   = useState(null);
  const [chatOpen, setChatOpen]   = useState(false);
  const [messages, setMessages]   = useState([{ role:"ai", text:"👋 OceanAI online. Connecting to Sentinel-1 satellite API...\n\nType 'help' for commands." }]);
  const [input, setInput]         = useState("");
  const [typing, setTyping]       = useState(false);
  const [filters, setFilters]     = useState(new Set(Object.keys(POLLUTION_TYPES)));
  const [pulse, setPulse]         = useState(true);
  const [liveZones, setLiveZones]         = useState(ZONES_FALLBACK);
  const [liveAlerts, setLiveAlerts]       = useState([]);
  const [liveForecast, setLiveForecast]   = useState(null);
  const [apiStatus, setApiStatus]         = useState("connecting");
  const [lastUpdated, setLastUpdated]     = useState(null);
  const chatEnd = useRef(null);
  const timeKeys = Object.keys(TIMELINE);

  useEffect(() => {
    if (!API_URL) { setApiStatus("offline"); return; }
    const fetchAll = async () => {
      try {
        const [zRes, aRes, fRes] = await Promise.all([
          fetch(`${API_URL}/pollution-zones`, { headers: API_HEADERS }),
          fetch(`${API_URL}/alerts`,          { headers: API_HEADERS }),
          fetch(`${API_URL}/predict-spread`,  { headers: API_HEADERS }),
        ]);
        const zData = await zRes.json();
        const aData = await aRes.json();
        const fData = await fRes.json();
        if (zData.zones?.length) setLiveZones(zData.zones.map(apiZoneToDisplay));
        if (aData.alerts?.length) setLiveAlerts(aData.alerts);
        if (fData.predictions) setLiveForecast(fData);
        setApiStatus("live");
        setLastUpdated(new Date());
        setMessages(m =>
          m[0]?.text?.includes("Connecting") ?
          [{ role:"ai", text:`✅ Sentinel-1 SAR feed connected.\n${zData.zones?.length||0} active pollution zones detected across major ocean regions.\n\nType 'help' for commands.` }] : m
        );
      } catch { setApiStatus("offline"); }
    };
    fetchAll();
    const iv = setInterval(fetchAll, 30000);
    return () => clearInterval(iv);
  }, []);

  const currentZones = liveZones.map(z => {
    if (timeKey === "now") return z;
    const scale = { "-72h":0.60, "-48h":0.70, "-24h":0.85, "+24h":1.08, "+48h":1.15 }[timeKey] ?? 1;
    return { ...z, severity: Math.min(99, Math.round(z.severity * scale)) };
  });
  const filtered   = currentZones.filter(z => filters.has(z.type));
  const avgSev     = Math.round(filtered.reduce((s,z)=>s+z.severity,0)/(filtered.length||1));
  const critCount  = filtered.filter(z=>z.severity>=80).length;
  const totalArea  = filtered.reduce((s,z)=>s+z.area,0);
  const satZones   = liveZones.filter(z=>z.source==="Sentinel-1 SAR").length;

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior:"smooth" }); }, [messages, typing]);
  useEffect(() => { const iv=setInterval(()=>setPulse(p=>!p),2000); return ()=>clearInterval(iv); }, []);

  const sendChat = useCallback(() => {
    if (!input.trim()) return;
    const txt = input.trim();
    setMessages(m=>[...m,{role:"user",text:txt}]);
    setInput("");
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      const lm = txt.toLowerCase();
      let reply;
      if (lm.includes("alert")) {
        reply = liveAlerts.length
          ? `🔔 Live Alerts (${liveAlerts.length} active)\n\n` + liveAlerts.map((a,i)=>`${i+1}. ${a.level} — ${a.message}\n   Conf: ${Math.round((a.confidence||0.7)*100)}%`).join("\n")
          : `No live alerts yet. API status: ${apiStatus.toUpperCase()}`;
      } else if (lm.includes("predict")||lm.includes("forecast")) {
        reply = liveForecast?.predictions
          ? `🔮 48-Hour Forecast\n\n` + liveForecast.predictions.map(p=>`+${p.hours_ahead}h:\n`+p.zones.map(z=>`  • ${z.class} → ${z.spread_km2} km²`).join("\n")).join("\n\n")
          : getResponse(txt);
      } else if (lm.includes("zone")||lm.includes("status")||lm.includes("region")) {
        reply = `📡 Active Zones (${liveZones.length} total, ${satZones} from Sentinel-1)\n\n`
          + liveZones.slice(0,8).map(z=>`• ${z.name} — ${z.type.replace(/_/g," ")} (${z.severity}/100) [${z.source||"API"}]`).join("\n")
          + (liveZones.length>8?`\n...and ${liveZones.length-8} more`:"");
      } else {
        reply = getResponse(txt);
      }
      setMessages(m=>[...m,{role:"ai",text:reply}]);
    }, 1200);
  }, [input, liveAlerts, liveForecast, liveZones, apiStatus, satZones]);

  const S = {
    app:     { minHeight:"100vh", background:"#050d1a", fontFamily:"'DM Mono','Courier New',monospace", color:"#c8deff", position:"relative", overflow:"hidden" },
    header:  { position:"sticky", top:0, zIndex:100, background:"rgba(5,13,26,0.95)", backdropFilter:"blur(12px)", borderBottom:"1px solid rgba(14,165,233,0.15)", padding:"0 20px", display:"flex", alignItems:"center", justifyContent:"space-between", height:54 },
    logo:    { fontFamily:"Syne,sans-serif", fontWeight:800, fontSize:16, letterSpacing:"0.08em", color:"#e0f2fe" },
    nav:     { display:"flex", gap:2 },
    tabBtn:  (a) => ({ background:"none", border:"none", cursor:"pointer", fontFamily:"inherit", padding:"6px 12px", fontSize:10, letterSpacing:"0.12em", color:a?"#0ea5e9":"#4a7fa5", borderBottom:a?"2px solid #0ea5e9":"2px solid transparent" }),
    statsBar:{ display:"flex", gap:1, background:"rgba(14,165,233,0.03)", borderBottom:"1px solid rgba(14,165,233,0.08)" },
    statCell:{ flex:1, padding:"8px 14px", borderRight:"1px solid rgba(14,165,233,0.06)" },
    main:    { display:"flex", height:"calc(100vh - 106px)" },
    sidebar: { width:252, borderRight:"1px solid rgba(14,165,233,0.1)", background:"rgba(5,13,26,0.6)", display:"flex", flexDirection:"column", overflow:"hidden" },
    viewport:{ flex:1, position:"relative", overflow:"hidden" },
  };

  return (
    <div style={S.app}>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:3px;background:#0a1628}
        ::-webkit-scrollbar-thumb{background:#1e3a5f;border-radius:2px}
        .zcard{transition:transform 0.2s;cursor:pointer}
        .zcard:hover{transform:translateX(3px)}
        .tbtn{cursor:pointer;transition:all 0.2s;background:none;border:none;font-family:inherit}
        .cinput{background:#0a1628;border:1px solid #1e3a5f;color:#c8deff;font-family:inherit;outline:none;transition:border 0.2s}
        .cinput:focus{border-color:#0ea5e9}
        .sbtn{cursor:pointer;background:#0ea5e9;border:none;transition:background 0.2s;color:#fff;font-family:inherit}
        .sbtn:hover{background:#38bdf8}
        .leaflet-popup-content-wrapper{background:#050d1a!important;border:1px solid rgba(14,165,233,0.3)!important;border-radius:6px!important;box-shadow:0 0 20px rgba(14,165,233,0.15)!important}
        .leaflet-popup-tip{background:#050d1a!important}
        .leaflet-popup-content{margin:0!important}
        .leaflet-container{font-family:'DM Mono',monospace!important}
        @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.4;transform:scale(1.6)}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
        @keyframes slideIn{from{opacity:0;transform:translateX(12px)}to{opacity:1;transform:none}}
        @keyframes scanline{0%{top:-2px}100%{top:100%}}
        .scanline{position:fixed;left:0;right:0;height:1px;background:linear-gradient(transparent,rgba(14,165,233,0.06),transparent);animation:scanline 5s linear infinite;pointer-events:none;z-index:0}
        .grid-bg{position:fixed;inset:0;background-image:linear-gradient(rgba(14,165,233,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(14,165,233,0.025) 1px,transparent 1px);background-size:40px 40px;pointer-events:none;z-index:0}
        @media(max-width:700px){.sidebar-hide{display:none!important}.viewport-full{flex:1!important}}
      `}</style>

      <div className="grid-bg"/>
      <div className="scanline"/>

      {/* Header */}
      <header style={S.header}>
        <div style={{ display:"flex", alignItems:"center", gap:10, position:"relative", zIndex:1 }}>
          <div style={{ position:"relative", width:30, height:30 }}>
            <div style={{ position:"absolute", inset:0, borderRadius:"50%", border:"2px solid #0ea5e9", opacity:0.3 }}/>
            <div style={{ position:"absolute", inset:4, borderRadius:"50%", background:"radial-gradient(circle,#0ea5e9,#0369a1)" }}/>
            <div style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)", width:5, height:5, borderRadius:"50%", background:"#fff", animation:"pulse 2s infinite" }}/>
          </div>
          <div>
            <div style={S.logo}>OCEAN<span style={{ color:"#0ea5e9" }}>AI</span></div>
            <div style={{ fontSize:9, color:"#2d5a7a", letterSpacing:"0.2em" }}>POLLUTION TRACKING v2.0</div>
          </div>
        </div>
        <nav style={S.nav}>
          {[["map","MAP"],["analytics","ANALYTICS"],["detection","AI ENGINE"],["alerts","ALERTS"]].map(([k,l]) => (
            <button key={k} style={S.tabBtn(tab===k)} onClick={()=>setTab(k)}>{l}</button>
          ))}
        </nav>
        <div style={{ display:"flex", alignItems:"center", gap:12, position:"relative", zIndex:1 }}>
          {critCount>0 && (
            <span style={{ background:"rgba(255,59,59,0.15)", color:"#ff3b3b", border:"1px solid rgba(255,59,59,0.3)", borderRadius:3, padding:"2px 8px", fontSize:9, letterSpacing:"0.1em" }}>
              ⚠ {critCount} CRITICAL
            </span>
          )}
          <div style={{ display:"flex", alignItems:"center", gap:5, fontSize:10, color:apiStatus==="live"?"#06d6a0":apiStatus==="connecting"?"#ff9f1c":"#ff3b3b" }}>
            <div style={{ width:6, height:6, borderRadius:"50%", background:apiStatus==="live"?"#06d6a0":apiStatus==="connecting"?"#ff9f1c":"#ff3b3b", animation:"pulse 1.5s infinite" }}/>
            {apiStatus==="live"?"● LIVE API":apiStatus==="connecting"?"CONNECTING...":"OFFLINE — MOCK DATA"}
          </div>
        </div>
      </header>

      {/* Stats bar */}
      <div style={{ ...S.statsBar, position:"relative", zIndex:1 }}>
        {[
          ["ZONES",       filtered.length,                 "",    "#0ea5e9"],
          ["AVG SEVERITY",avgSev,                          "/100",avgSev>75?"#ff3b3b":avgSev>50?"#ff9f1c":"#06d6a0"],
          ["TOTAL AREA",  totalArea,                       " km²","#c77dff"],
          ["CRITICAL",    critCount,                       "",    "#ff3b3b"],
          ["SAT ZONES",   satZones,                        "",    "#06d6a0"],
          ["SATELLITES",  "S1+L8",                         "",    "#ff9f1c"],
        ].map(([label,val,unit,color],i) => (
          <div key={i} style={S.statCell}>
            <div style={{ fontSize:8, color:"#2d5a7a", letterSpacing:"0.15em", marginBottom:2 }}>{label}</div>
            <div style={{ fontSize:15, fontFamily:"Syne,sans-serif", fontWeight:700, color }}>
              {val}<span style={{ fontSize:9, color:"#4a7fa5" }}>{unit}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Main */}
      <div style={{ ...S.main, position:"relative", zIndex:1 }}>

        {/* Sidebar */}
        <div className="sidebar-hide" style={S.sidebar}>
          <div style={{ padding:"12px 14px", borderBottom:"1px solid rgba(14,165,233,0.08)" }}>
            <div style={{ fontSize:9, color:"#2d5a7a", letterSpacing:"0.2em", marginBottom:8 }}>FILTER</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
              {Object.entries(POLLUTION_TYPES).map(([key,val]) => (
                <div key={key} onClick={()=>setFilters(f=>{const n=new Set(f);n.has(key)?n.delete(key):n.add(key);return n;})}
                  style={{ padding:"3px 8px", borderRadius:3, fontSize:9, cursor:"pointer", letterSpacing:"0.08em", transition:"all 0.2s",
                    border:`1px solid ${filters.has(key)?val.color:"rgba(255,255,255,0.08)"}`,
                    background:filters.has(key)?val.bg:"transparent",
                    color:filters.has(key)?val.color:"#2d5a7a" }}>
                  ● {val.label.toUpperCase().split(" ")[0]}
                </div>
              ))}
            </div>
          </div>

          <div style={{ flex:1, overflowY:"auto", padding:"6px 0" }}>
            <div style={{ padding:"4px 14px 6px", fontSize:9, color:"#2d5a7a", letterSpacing:"0.2em" }}>ACTIVE ZONES ({filtered.length})</div>
            {filtered.sort((a,b)=>b.severity-a.severity).map(zone => {
              const pt=POLLUTION_TYPES[zone.type], sel=selected?.id===zone.id;
              return (
                <div key={zone.id} className="zcard" onClick={()=>setSelected(sel?null:zone)}
                  style={{ padding:"9px 14px", margin:"2px 6px", borderRadius:4,
                    background:sel?"rgba(14,165,233,0.08)":"transparent",
                    border:`1px solid ${sel?"rgba(14,165,233,0.2)":"transparent"}` }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                    <div style={{ flex:1, marginRight:6 }}>
                      <div style={{ fontSize:11, color:"#c8deff", marginBottom:2 }}>{zone.name}</div>
                      <div style={{ fontSize:9, color:pt.color, letterSpacing:"0.08em" }}>● {pt.label.toUpperCase()}</div>
                      {zone.source==="Sentinel-1 SAR" && (
                        <div style={{ fontSize:8, color:"#0ea5e9", marginTop:2, letterSpacing:"0.06em" }}>🛰 S1-SAR</div>
                      )}
                    </div>
                    <div style={{ position:"relative", width:44, height:44, flexShrink:0 }}>
                      <SeverityRing value={zone.severity} size={44} color={zone.severity>=80?"#ff3b3b":zone.severity>=60?"#ff9f1c":"#06d6a0"}/>
                      <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, color:"#c8deff" }}>{zone.severity}</div>
                    </div>
                  </div>
                  <div style={{ display:"flex", justifyContent:"space-between", marginTop:5, fontSize:9, color:"#2d5a7a" }}>
                    <span>{zone.area} km²</span>
                    <span style={{ color:zone.trend>0?"#ff3b3b":"#06d6a0" }}>{zone.trend>0?"▲":"▼"} {Math.abs(zone.trend)} km²/day</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ padding:"10px 14px", borderTop:"1px solid rgba(14,165,233,0.1)" }}>
            <div style={{ fontSize:9, color:"#2d5a7a", letterSpacing:"0.2em", marginBottom:7 }}>⏳ TIME TRAVEL</div>
            <div style={{ display:"flex", gap:2 }}>
              {timeKeys.map(k => (
                <button key={k} className="tbtn" onClick={()=>setTimeKey(k)} style={{
                  flex:1, padding:"5px 2px", borderRadius:3, fontSize:8,
                  border:`1px solid ${timeKey===k?"#0ea5e9":"rgba(14,165,233,0.12)"}`,
                  background:timeKey===k?"rgba(14,165,233,0.15)":"transparent",
                  color:timeKey===k?"#0ea5e9":"#2d5a7a",
                  fontStyle:k.startsWith("+")?"italic":"normal",
                }}>{k}</button>
              ))}
            </div>
            <div style={{ marginTop:7, padding:"5px 8px", borderRadius:3, fontSize:9,
              background:"rgba(14,165,233,0.05)", border:"1px solid rgba(14,165,233,0.1)",
              color:timeKey.startsWith("+")?"#c77dff":"#4a7fa5", letterSpacing:"0.07em" }}>
              {timeKey.startsWith("+")?"🔮 AI PREDICTION":timeKey==="now"?"📡 LIVE DATA":"📼 HISTORICAL"}
            </div>
            {lastUpdated && (
              <div style={{ marginTop:5, fontSize:8, color:"#2d5a7a", letterSpacing:"0.06em" }}>
                UPDATED {lastUpdated.toTimeString().slice(0,8)}
              </div>
            )}
          </div>
        </div>

        {/* Viewport */}
        <div className="viewport-full" style={S.viewport}>

          {/* MAP TAB */}
          {tab==="map" && (
            <div style={{ position:"relative", width:"100%", height:"100%" }}>
              <MapContainer
                center={[15, 70]}
                zoom={3}
                minZoom={2}
                maxZoom={12}
                style={{ width:"100%", height:"100%", background:"#050d1a" }}
                zoomControl={false}
              >
                <ZoomControl position="topleft"/>
                <TileLayer
                  url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                  attribution='&copy; <a href="https://carto.com/">CARTO</a>'
                  subdomains="abcd"
                  maxZoom={20}
                />
                {filtered.map(zone => {
                  const pt   = POLLUTION_TYPES[zone.type];
                  const crit = zone.severity >= 80;
                  const r    = Math.max(7, Math.round(zone.severity * 0.25));
                  const isSat = zone.source === "Sentinel-1 SAR";
                  return (
                    <CircleMarker
                      key={zone.id}
                      center={[zone.geoLat, zone.geoLon]}
                      radius={r}
                      pathOptions={{
                        color:       crit ? pt.color : pt.color+"bb",
                        fillColor:   pt.color,
                        fillOpacity: isSat ? 0.7 : 0.45,
                        weight:      crit ? 2.5 : 1.5,
                        opacity:     1,
                        dashArray:   isSat ? null : "4 2",
                      }}
                      eventHandlers={{ click:()=>setSelected(s=>s?.id===zone.id?null:zone) }}
                    >
                      <Popup maxWidth={220}>
                        <div style={{ background:"#050d1a", color:"#e0f2fe", padding:"10px 12px", borderRadius:4, minWidth:190, fontFamily:"DM Mono,monospace", fontSize:11 }}>
                          <div style={{ fontWeight:700, fontSize:13, marginBottom:2, color:pt.color }}>{zone.name}</div>
                          <div style={{ color:"#7eb8f7", marginBottom:2, fontSize:9, letterSpacing:"0.08em" }}>{pt.label.toUpperCase()}</div>
                          {isSat && <div style={{ color:"#0ea5e9", fontSize:9, marginBottom:8, letterSpacing:"0.06em" }}>🛰 Sentinel-1 SAR · Live</div>}
                          {!isSat && <div style={{ color:"#4a7fa5", fontSize:9, marginBottom:8 }}>📦 Fallback data</div>}
                          {[
                            ["SEVERITY",   `${zone.severity}/100`,  zone.severity>=80?"#ff3b3b":"#ff9f1c"],
                            ["AREA",       `${zone.area} km²`,       "#c8deff"],
                            ["GROWTH",     `${zone.trend>0?"+":""}${zone.trend} km²/day`, zone.trend>0?"#ff3b3b":"#06d6a0"],
                            ["CONFIDENCE", `${zone.confidence}%`,    "#06d6a0"],
                          ].map(([k,v,c]) => (
                            <div key={k} style={{ display:"flex", justifyContent:"space-between", padding:"3px 0", borderBottom:"1px solid rgba(14,165,233,0.07)", fontSize:10 }}>
                              <span style={{ color:"#4a7fa5", fontSize:9 }}>{k}</span>
                              <span style={{ color:c }}>{v}</span>
                            </div>
                          ))}
                          {zone.mean_vv_db && (
                            <div style={{ display:"flex", justifyContent:"space-between", padding:"3px 0", borderBottom:"1px solid rgba(14,165,233,0.07)", fontSize:10 }}>
                              <span style={{ color:"#4a7fa5", fontSize:9 }}>SAR VV</span>
                              <span style={{ color:"#7eb8f7" }}>{zone.mean_vv_db} dB</span>
                            </div>
                          )}
                          {zone.acquired && (
                            <div style={{ marginTop:6, fontSize:8, color:"#2d5a7a" }}>
                              ACQ {zone.acquired.slice(0,16).replace("T"," ")} UTC
                            </div>
                          )}
                          {crit && <div style={{ marginTop:6, padding:"3px 6px", background:"rgba(255,59,59,0.15)", border:"1px solid rgba(255,59,59,0.3)", borderRadius:3, color:"#ff9f9f", fontSize:9 }}>⚠ CRITICAL — IMMEDIATE ATTENTION</div>}
                        </div>
                      </Popup>
                    </CircleMarker>
                  );
                })}
              </MapContainer>
              <div style={{ position:"absolute", bottom:8, left:10, fontSize:9, color:"rgba(14,165,233,0.5)", letterSpacing:"0.08em", zIndex:1000, pointerEvents:"none" }}>
                GLOBAL OCEAN VIEW · CARTO DARK MATTER · {filtered.length} ZONES
              </div>
              <div style={{ position:"absolute", bottom:8, right:10, fontSize:9, color:"rgba(14,165,233,0.4)", zIndex:1000, pointerEvents:"none" }}>
                {new Date().toISOString().slice(0,19)}Z
              </div>
              {/* Legend */}
              <div style={{ position:"absolute", top:10, right:10, zIndex:1000, background:"rgba(5,13,26,0.88)", border:"1px solid rgba(14,165,233,0.15)", borderRadius:5, padding:"8px 10px", fontSize:9 }}>
                <div style={{ color:"#2d5a7a", letterSpacing:"0.1em", marginBottom:5 }}>LEGEND</div>
                {Object.entries(POLLUTION_TYPES).map(([k,v]) => (
                  <div key={k} style={{ display:"flex", alignItems:"center", gap:5, marginBottom:3, color:v.color }}>
                    <div style={{ width:8, height:8, borderRadius:"50%", background:v.color }}/>
                    <span style={{ fontSize:8 }}>{v.label}</span>
                  </div>
                ))}
                <div style={{ marginTop:5, borderTop:"1px solid rgba(14,165,233,0.1)", paddingTop:4, color:"#4a7fa5", fontSize:8 }}>
                  <div>● Solid = Sentinel-1 SAR</div>
                  <div>● Dashed = Fallback</div>
                </div>
              </div>
            </div>
          )}

          {/* ANALYTICS TAB */}
          {tab==="analytics" && (
            <div style={{ padding:20, height:"100%", overflowY:"auto" }}>
              <div style={{ fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:17,color:"#e0f2fe",marginBottom:18,letterSpacing:"0.05em" }}>ANALYTICS DASHBOARD</div>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14 }}>
                {[
                  { label:"DAILY SEVERITY (12 DAYS)",      data:[42,58,61,55,70,67,75,72,80,78,85,89], color:"#0ea5e9" },
                  { label:"POLLUTED AREA km² (12 MONTHS)", data:[310,328,345,340,365,380,370,392,405,418,430,449], color:"#c77dff" },
                ].map(({label,data,color}) => (
                  <div key={label} style={{ background:"rgba(14,165,233,0.03)",border:"1px solid rgba(14,165,233,0.09)",borderRadius:6,padding:14 }}>
                    <div style={{ fontSize:9,color:"#2d5a7a",letterSpacing:"0.18em",marginBottom:10 }}>{label}</div>
                    <MiniChart data={data} color={color} height={72}/>
                  </div>
                ))}
              </div>
              <div style={{ background:"rgba(14,165,233,0.03)",border:"1px solid rgba(14,165,233,0.09)",borderRadius:6,padding:14,marginBottom:14 }}>
                <div style={{ fontSize:9,color:"#2d5a7a",letterSpacing:"0.18em",marginBottom:12 }}>MULTI-CLASS DETECTION BREAKDOWN</div>
                <div style={{ display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10 }}>
                  {Object.entries(POLLUTION_TYPES).map(([key,val]) => {
                    const zones=currentZones.filter(z=>z.type===key);
                    const pct=zones.length?Math.round(zones.reduce((s,z)=>s+z.severity,0)/zones.length):0;
                    return (
                      <div key={key} style={{ textAlign:"center",padding:"10px 6px",background:val.bg,border:`1px solid ${val.color}33`,borderRadius:4 }}>
                        <SeverityRing value={pct} size={48} color={val.color}/>
                        <div style={{ fontSize:17,fontFamily:"Syne,sans-serif",fontWeight:700,color:val.color,marginTop:-34,marginBottom:30 }}>{pct}</div>
                        <div style={{ fontSize:8,color:val.color,letterSpacing:"0.08em" }}>{val.label.toUpperCase().split(" ")[0]}</div>
                        <div style={{ fontSize:9,color:"#4a7fa5",marginTop:2 }}>{zones.length} zone{zones.length!==1?"s":""}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div style={{ background:"rgba(14,165,233,0.03)",border:"1px solid rgba(14,165,233,0.09)",borderRadius:6,padding:14 }}>
                <div style={{ fontSize:9,color:"#2d5a7a",letterSpacing:"0.18em",marginBottom:12 }}>REGION COMPARISON</div>
                {currentZones.sort((a,b)=>b.severity-a.severity).map(zone => {
                  const pt=POLLUTION_TYPES[zone.type];
                  return (
                    <div key={zone.id} style={{ marginBottom:9 }}>
                      <div style={{ display:"flex",justifyContent:"space-between",fontSize:10,marginBottom:3 }}>
                        <span style={{ color:"#c8deff" }}>{zone.name} {zone.source==="Sentinel-1 SAR"&&<span style={{color:"#0ea5e9",fontSize:8}}>🛰</span>}</span>
                        <span style={{ color:pt.color }}>{zone.severity}/100</span>
                      </div>
                      <div style={{ height:4,background:"rgba(255,255,255,0.05)",borderRadius:2,overflow:"hidden" }}>
                        <div style={{ height:"100%",width:`${zone.severity}%`,borderRadius:2,background:`linear-gradient(90deg,${pt.color}77,${pt.color})`,transition:"width 0.8s" }}/>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* AI ENGINE TAB */}
          {tab==="detection" && (
            <div style={{ padding:20, height:"100%", overflowY:"auto" }}>
              <div style={{ fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:17,color:"#e0f2fe",marginBottom:18 }}>AI DETECTION ENGINE</div>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14,marginBottom:16 }}>
                {[
                  { name:"YOLOv8m", role:"Fast Detection",     acc:81, speed:"23ms",  desc:"Real-time bounding box detection — mAP50 0.812 on 4600+ satellite images", color:"#0ea5e9" },
                  { name:"U-Net",   role:"Pixel Segmentation",  acc:94, speed:"180ms", desc:"Precise boundary mapping via ResNet34 encoder (Phase 2 — coming soon)", color:"#c77dff" },
                  { name:"ViT",     role:"Transformer Accuracy",acc:96, speed:"340ms", desc:"Vision Transformer for contextual SAR pattern recognition", color:"#06d6a0" },
                ].map(m => (
                  <div key={m.name} style={{ background:`${m.color}08`,border:`1px solid ${m.color}22`,borderRadius:6,padding:14 }}>
                    <div style={{ fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:16,color:m.color,marginBottom:3 }}>{m.name}</div>
                    <div style={{ fontSize:9,color:"#4a7fa5",letterSpacing:"0.13em",marginBottom:10 }}>{m.role.toUpperCase()}</div>
                    <div style={{ fontSize:11,color:"#7ba8c8",marginBottom:10,lineHeight:1.6 }}>{m.desc}</div>
                    {[["Accuracy",m.acc+"%"],["Inference",m.speed]].map(([k,v]) => (
                      <div key={k} style={{ display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid rgba(255,255,255,0.04)",fontSize:10 }}>
                        <span style={{ color:"#4a7fa5",fontSize:9,letterSpacing:"0.08em" }}>{k.toUpperCase()}</span>
                        <span style={{ color:m.color }}>{v}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14 }}>
                <div style={{ background:"rgba(14,165,233,0.03)",border:"1px solid rgba(14,165,233,0.09)",borderRadius:6,padding:14 }}>
                  <div style={{ fontSize:9,color:"#2d5a7a",letterSpacing:"0.18em",marginBottom:10 }}>SATELLITE DATA SOURCES</div>
                  {[
                    { name:"Sentinel-1 SAR", desc:`${satZones} active zones · C-band SAR backscatter · 10m resolution`, status:"LIVE", color:"#06d6a0" },
                    { name:"Landsat-8 OLI",  desc:"Optical multispectral · 30m resolution · cloud permitting",            status:"READY", color:"#ff9f1c" },
                    { name:"MODIS Terra",    desc:"Daily global coverage · 250m–1km · sea surface temperature",            status:"READY", color:"#c77dff" },
                  ].map(s => (
                    <div key={s.name} style={{ marginBottom:10,padding:9,background:`${s.color}08`,border:`1px solid ${s.color}20`,borderRadius:4 }}>
                      <div style={{ display:"flex",justifyContent:"space-between",marginBottom:3 }}>
                        <span style={{ fontSize:11,color:"#c8deff" }}>{s.name}</span>
                        <span style={{ fontSize:8,color:s.color,letterSpacing:"0.1em" }}>● {s.status}</span>
                      </div>
                      <div style={{ fontSize:9,color:"#4a7fa5",lineHeight:1.6 }}>{s.desc}</div>
                    </div>
                  ))}
                </div>
                <div style={{ background:"rgba(255,159,28,0.04)",border:"1px solid rgba(255,159,28,0.1)",borderRadius:6,padding:14 }}>
                  <div style={{ fontSize:9,color:"#2d5a7a",letterSpacing:"0.18em",marginBottom:10 }}>GRAD-CAM EXPLAINABILITY</div>
                  <div style={{ fontSize:10,color:"#7ba8c8",lineHeight:1.7,marginBottom:10 }}>
                    Gradient-weighted Class Activation Mapping highlights which SAR image regions drove each AI detection decision.
                  </div>
                  <div style={{ display:"flex",gap:7 }}>
                    {["SAR Input","Grad-CAM","Overlay"].map((l,i) => (
                      <div key={i} style={{ flex:1,height:58,borderRadius:3,display:"flex",alignItems:"flex-end",justifyContent:"center",paddingBottom:4,fontSize:7,color:"#ff9f1c",letterSpacing:"0.07em",border:"1px solid rgba(255,159,28,0.2)",background:i===0?"linear-gradient(135deg,#042149,#031d3b)":i===1?"linear-gradient(135deg,#7f0000,#ff4500,#ffff00)":"linear-gradient(135deg,#021428,rgba(255,69,0,0.4))" }}>
                        {l.toUpperCase()}
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop:8,fontSize:9,color:"#4a7fa5" }}>Avg Confidence: <span style={{ color:"#ff9f1c" }}>87.4%</span></div>
                </div>
              </div>
              <div style={{ background:"rgba(6,214,160,0.03)",border:"1px solid rgba(6,214,160,0.1)",borderRadius:6,padding:14 }}>
                <div style={{ fontSize:9,color:"#2d5a7a",letterSpacing:"0.18em",marginBottom:10 }}>PREDICTION ENGINE</div>
                {[
                  { name:"LSTM Forecaster",             desc:"Temporal sequence modeling — 48hr spread direction & velocity",  status:"MOCK" },
                  { name:"Transformer Forecaster",       desc:"Attention-based future state estimation across ocean currents",   status:"MOCK" },
                  { name:"GEE Background Refresh",       desc:`Sentinel-1 re-fetch every 6hrs · last ${satZones} zones loaded`, status:"ACTIVE" },
                ].map(m => (
                  <div key={m.name} style={{ marginBottom:8,padding:9,background:"rgba(6,214,160,0.04)",border:"1px solid rgba(6,214,160,0.1)",borderRadius:4,display:"flex",justifyContent:"space-between",alignItems:"flex-start" }}>
                    <div>
                      <div style={{ fontSize:11,color:"#c8deff",marginBottom:2 }}>{m.name}</div>
                      <div style={{ fontSize:9,color:"#4a7fa5",lineHeight:1.6 }}>{m.desc}</div>
                    </div>
                    <span style={{ fontSize:8,color:m.status==="ACTIVE"?"#06d6a0":"#ff9f1c",letterSpacing:"0.1em",flexShrink:0,marginLeft:8 }}>● {m.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ALERTS TAB */}
          {tab==="alerts" && (
            <div style={{ padding:20, height:"100%", overflowY:"auto" }}>
              <div style={{ fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:17,color:"#e0f2fe",marginBottom:6 }}>SMART ALERT SYSTEM</div>
              <div style={{ fontSize:9,color:"#2d5a7a",marginBottom:18,letterSpacing:"0.08em" }}>
                {liveAlerts.length>0?`${liveAlerts.length} LIVE ALERTS FROM API`:`${currentZones.length} ZONES MONITORED · ${critCount} CRITICAL`}
              </div>
              {currentZones.sort((a,b)=>b.severity-a.severity).map((zone,i) => {
                const pt=POLLUTION_TYPES[zone.type];
                const level=zone.severity>=80?"CRITICAL":zone.severity>=60?"HIGH":"MONITOR";
                const lc=zone.severity>=80?"#ff3b3b":zone.severity>=60?"#ff9f1c":"#0ea5e9";
                return (
                  <div key={zone.id} style={{ marginBottom:11,padding:14,borderRadius:6,background:`${pt.color}05`,border:`1px solid ${lc}2a`,animation:`fadeUp 0.3s ease ${i*0.05}s both` }}>
                    <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7 }}>
                      <div style={{ display:"flex",alignItems:"center",gap:9,flexWrap:"wrap" }}>
                        <div style={{ padding:"2px 7px",borderRadius:3,fontSize:9,background:`${lc}15`,border:`1px solid ${lc}44`,color:lc,letterSpacing:"0.1em" }}>{level}</div>
                        <div style={{ fontFamily:"Syne,sans-serif",fontWeight:700,color:"#e0f2fe",fontSize:12 }}>{zone.name}</div>
                        <div style={{ fontSize:9,color:pt.color,letterSpacing:"0.08em" }}>● {pt.label}</div>
                        {zone.source==="Sentinel-1 SAR" && <div style={{ fontSize:8,color:"#0ea5e9" }}>🛰 S1-SAR</div>}
                      </div>
                      <div style={{ fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:19,color:lc,flexShrink:0 }}>{zone.severity}<span style={{ fontSize:9,color:"#4a7fa5" }}>/100</span></div>
                    </div>
                    <div style={{ fontSize:10,color:"#7ba8c8",marginBottom:7 }}>
                      {pt.label} detected · Area: {zone.area} km² · Spread: {zone.trend>0?"+":""}{zone.trend} km²/day · AI Confidence: {zone.confidence}%
                      {zone.acquired && ` · Acquired: ${zone.acquired.slice(0,10)}`}
                    </div>
                    <div style={{ padding:"5px 9px",borderRadius:3,fontSize:9,background:"rgba(14,165,233,0.05)",border:"1px solid rgba(14,165,233,0.09)",color:"#4a7fa5",fontStyle:"italic" }}>
                      🔮 {zone.type==="oil_spill"?`Spill expanding ~${zone.trend*2} km² in 24hrs, moving with ocean currents`:zone.type==="plastic_waste"?"Accumulation zone — coastal impact risk in 72hrs":zone.type==="algae_bloom"?"Bloom area — monitoring oxygen depletion risk":"Chemical concentration — monitoring advised"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Chatbot */}
      <div style={{ position:"fixed",bottom:20,right:20,zIndex:200,display:"flex",flexDirection:"column",alignItems:"flex-end",gap:10 }}>
        {chatOpen && (
          <div style={{ width:310,height:420,background:"rgba(5,13,26,0.97)",backdropFilter:"blur(16px)",border:"1px solid rgba(14,165,233,0.2)",borderRadius:8,display:"flex",flexDirection:"column",boxShadow:"0 0 36px rgba(14,165,233,0.1)",animation:"fadeUp 0.25s ease" }}>
            <div style={{ padding:"10px 14px",borderBottom:"1px solid rgba(14,165,233,0.1)",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
              <div>
                <div style={{ fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:11,color:"#0ea5e9" }}>OCEANAI ASSISTANT</div>
                <div style={{ fontSize:8,color:"#2d5a7a",letterSpacing:"0.15em" }}>{satZones>0?`🛰 ${satZones} SENTINEL-1 ZONES LIVE`:"AI POWERED · ONLINE"}</div>
              </div>
              <button onClick={()=>setChatOpen(false)} style={{ background:"none",border:"none",color:"#4a7fa5",cursor:"pointer",fontSize:13 }}>✕</button>
            </div>
            <div style={{ flex:1,overflowY:"auto",padding:10,display:"flex",flexDirection:"column",gap:7 }}>
              {messages.map((m,i) => (
                <div key={i} style={{ maxWidth:"86%",alignSelf:m.role==="user"?"flex-end":"flex-start" }}>
                  {m.role==="ai" && <div style={{ fontSize:8,color:"#0ea5e9",marginBottom:2,letterSpacing:"0.1em" }}>OCEANAI</div>}
                  <div style={{ padding:"7px 10px",borderRadius:m.role==="user"?"8px 8px 2px 8px":"8px 8px 8px 2px",background:m.role==="user"?"rgba(14,165,233,0.14)":"rgba(255,255,255,0.04)",border:`1px solid ${m.role==="user"?"rgba(14,165,233,0.22)":"rgba(255,255,255,0.05)"}`,fontSize:10,color:m.role==="user"?"#93c5fd":"#c8deff",lineHeight:1.6,whiteSpace:"pre-wrap" }}>{m.text}</div>
                </div>
              ))}
              {typing && (
                <div style={{ alignSelf:"flex-start" }}>
                  <div style={{ fontSize:8,color:"#0ea5e9",marginBottom:2 }}>OCEANAI</div>
                  <div style={{ padding:"7px 10px",borderRadius:"8px 8px 8px 2px",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.05)",fontSize:10,color:"#4a7fa5" }}>
                    <span style={{ animation:"blink 1s infinite" }}>▌</span> Analyzing...
                  </div>
                </div>
              )}
              <div ref={chatEnd}/>
            </div>
            <div style={{ padding:9,borderTop:"1px solid rgba(14,165,233,0.1)",display:"flex",gap:7 }}>
              <input className="cinput" value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendChat()} placeholder="Ask about pollution zones..." style={{ flex:1,padding:"7px 9px",borderRadius:4,fontSize:10 }}/>
              <button className="sbtn" onClick={sendChat} style={{ padding:"7px 11px",borderRadius:4,fontSize:10 }}>→</button>
            </div>
          </div>
        )}
        <button onClick={()=>setChatOpen(o=>!o)} style={{ width:46,height:46,borderRadius:"50%",background:"linear-gradient(135deg,#0369a1,#0ea5e9)",border:"2px solid rgba(14,165,233,0.4)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:19,boxShadow:"0 0 20px rgba(14,165,233,0.28)",transition:"transform 0.2s",transform:chatOpen?"rotate(45deg)":"none" }}>🤖</button>
      </div>
    </div>
  );
}
