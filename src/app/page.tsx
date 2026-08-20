'use client';

import { useEffect, useState } from 'react';

export default function Home() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/forecast')
      .then(res => res.json())
      .then(data => {
        setData(data);
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="min-h-screen bg-gray-100 flex items-center justify-center font-bold text-xl">Loading Aglou Data...</div>;

  return (
    <div className="min-h-screen bg-gray-100 p-2 md:p-6 text-gray-900 font-sans">
      <div className="max-w-3xl mx-auto bg-white rounded-lg shadow-xl overflow-hidden">
        
        {/* Header */}
        <div className="bg-red-700 text-white p-4 flex justify-between items-center">
          <h1 className="text-xl font-bold uppercase tracking-wider">Aglou Beach</h1>
          <span className="text-sm font-semibold bg-white text-red-700 px-3 py-1 rounded-full shadow">Strike Score Engine</span>
        </div>

        {/* Table Headers */}
        <div className="grid grid-cols-5 text-center text-xs text-gray-500 font-bold p-2 border-b">
          <div>Time</div>
          <div>Wind</div>
          <div>Sky</div>
          <div>Temp/hPa</div>
          <div>Waves/Tide</div>
        </div>

        {/* Forecast Rows */}
        <div className="flex flex-col">
          {data.map((row, idx) => (
            <div key={idx} className={`grid grid-cols-5 text-center items-center py-3 border-b border-l-8 ${row.colorClass} transition-all hover:bg-gray-50`}>
              
              {/* Col 1: Time */}
              <div className="font-bold text-base bg-white rounded shadow-sm mx-auto px-2 py-1">
                {row.time}
              </div>

              {/* Col 2: Wind */}
              <div className="flex flex-col text-sm">
                <span className="font-bold">{Math.round(row.windSpeed)} km/h</span>
                <span className="text-xs text-gray-500">max {Math.round(row.windGust)}</span>
              </div>

              {/* Col 3: Stealth/Weather */}
              <div className="text-2xl">
                {row.weatherIcon}
              </div>

              {/* Col 4: Environment */}
              <div className="flex flex-col text-sm">
                <span className="font-bold text-orange-600">{row.waterTemp}°C</span>
                <span className="text-xs text-gray-500">{row.pressure} hPa</span>
              </div>

              {/* Col 5: Master Column (Waves & Tide) */}
              <div className="flex flex-col items-center text-sm font-bold">
                <span className="flex items-center gap-1">🌊 {row.waveHeight}m</span>
                <span className="text-xs text-gray-500">{row.wavePeriod} s</span>
                <span className="text-lg mt-1" title="Tide Indicator">{row.tideIcon}</span>
              </div>

            </div>
          ))}
        </div>
        
        <div className="p-3 text-xs text-center text-gray-500 bg-gray-50 border-t">
          Score Legend: 🟢 10-12 (Epic) | 🟡 7-9 (Good) | ⚪ 4-6 (Tough) | 🔴 &lt;4 (Terrible)
        </div>
      </div>
    </div>
  );
}
