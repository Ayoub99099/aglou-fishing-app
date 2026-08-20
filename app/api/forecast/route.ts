import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // Aglou Plage Coordinates
    const LAT = 29.805;
    const LON = -9.983;

    // Fetch Weather & Marine Data from Open-Meteo
    const weatherReq = fetch(`https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&hourly=temperature_2m,surface_pressure,cloudcover,wind_speed_10m,wind_gusts_10m,is_day&timezone=Africa%2FCasablanca`);
    const marineReq = fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${LAT}&longitude=${LON}&hourly=wave_height,wave_period,sea_level&timezone=Africa%2FCasablanca`);

    const [weatherRes, marineRes] = await Promise.all([weatherReq, marineReq]);
    const weatherData = await weatherRes.json();
    const marineData = await marineRes.json();

    const forecast = [];
    const currentTimeIndex = weatherData.hourly.time.findIndex((t: string) => new Date(t) > new Date());
    const startIndex = currentTimeIndex > 0 ? currentTimeIndex - 1 : 0;

    // Process 24 hours of data in 2-hour intervals
    for (let i = startIndex; i < startIndex + 24; i += 2) {
      if (!weatherData.hourly.time[i]) break;

      const time = new Date(weatherData.hourly.time[i]);
      const waveHeight = marineData.hourly.wave_height[i];
      const wavePeriod = Math.round(marineData.hourly.wave_period[i]);
      const windGust = weatherData.hourly.wind_gusts_10m[i];
      const windSpeed = weatherData.hourly.wind_speed_10m[i];
      const pressure = weatherData.hourly.surface_pressure[i];
      const isDay = weatherData.hourly.is_day[i];
      const cloudCover = weatherData.hourly.cloudcover[i];
      const waterTemp = weatherData.hourly.temperature_2m[i]; // Using surface temp proxy

      // Calculate Tide Logic (using OpenMeteo Sea Level)
      let tideIcon = "⚪";
      let tideScore = 0;
      
      const currentLevel = marineData.hourly.sea_level[i];
      const nextLevel = marineData.hourly.sea_level[i + 1];
      const prevLevel = marineData.hourly.sea_level[i - 1];

      // Simple Slack/Peak detection
      if (currentLevel > prevLevel && currentLevel > nextLevel) {
        tideIcon = "H"; tideScore = 1; // High Tide Slack
      } else if (currentLevel < prevLevel && currentLevel < nextLevel) {
        tideIcon = "L"; tideScore = -2; // Low Tide Slack
      } else if (nextLevel > currentLevel) {
        tideIcon = "⬆️"; 
        // Golden Window check: If we are close to the peak (higher sea level)
        tideScore = (currentLevel > 0) ? 3 : 1; 
      } else {
        tideIcon = "⬇️"; tideScore = -2; // Falling
      }

      // 1. Wave Factor
      let waveScore = 0;
      if (waveHeight >= 0.8 && waveHeight <= 1.4) waveScore = 3;
      else if ((waveHeight >= 0.6 && waveHeight < 0.8) || (waveHeight > 1.4 && waveHeight <= 1.7)) waveScore = 1;
      else if (waveHeight >= 1.8 && waveHeight <= 1.9) waveScore = 0;
      else waveScore = -3;

      // 2. Wind Gust Factor
      let windScore = 0;
      if (windGust < 15) windScore = 2;
      else if (windGust <= 22) windScore = 0;
      else windScore = -3;

      // 3. Pressure Factor
      let pressureScore = 0;
      if (pressure >= 1012 && pressure <= 1020) pressureScore = 1;
      else if (pressure < 1005) pressureScore = -1;
      else pressureScore = 0; // Baseline

      // 4. Stealth Factor
      let stealthScore = 0;
      if (!isDay || cloudCover > 80) stealthScore = 2;
      else stealthScore = -1;

      // Total Score
      const totalScore = waveScore + windScore + tideScore + pressureScore + stealthScore;

      // Color Coding Logic
      let colorClass = "";
      if (totalScore >= 10) colorClass = "border-green-500 bg-green-500/10";
      else if (totalScore >= 7) colorClass = "border-yellow-400 bg-yellow-400/10";
      else if (totalScore >= 4) colorClass = "border-blue-200 bg-white";
      else colorClass = "border-red-600 bg-red-600/10";

      let weatherIcon = !isDay ? "🌙" : (cloudCover > 50 ? "☁️" : "☀️");

      forecast.push({
        time: time.toLocaleTimeString('en-US', { hour: '2-digit', hour12: false }) + ' h',
        waveHeight, wavePeriod, windGust, windSpeed, pressure: Math.round(pressure),
        waterTemp: Math.round(waterTemp), tideIcon, totalScore, colorClass, weatherIcon
      });
    }

    return NextResponse.json(forecast);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 });
  }
}
