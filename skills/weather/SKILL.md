# Weather Skill

## Primary: wttr.in
```bash
curl -s 'wttr.in/Warren+NJ?format=3'
# Detailed:
curl -s 'wttr.in/Warren+NJ'
```

## Fallback: Open-Meteo (free, no API key)
If wttr.in is down or times out, use Open-Meteo:
```bash
curl -s "https://api.open-meteo.com/v1/forecast?latitude=40.63&longitude=-74.49&current_weather=true&temperature_unit=fahrenheit&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode&timezone=America/New_York&forecast_days=3"
```

### Open-Meteo Response Format
Returns JSON with:
- `current_weather`: temperature (°F), windspeed, winddirection, weathercode, time
- `daily`: max/min temps, precipitation, weathercodes for 3 days

### Weather Codes (WMO)
| Code | Meaning |
|------|---------|
| 0 | Clear sky |
| 1-3 | Partly cloudy |
| 45, 48 | Fog |
| 51-55 | Drizzle |
| 61-65 | Rain |
| 71-75 | Snow |
| 80-82 | Rain showers |
| 85-86 | Snow showers |
| 95-99 | Thunderstorm |

## Strategy
1. Try wttr.in first (simpler output, human-readable)
2. If it fails/times out (5s), fall back to Open-Meteo
3. Parse Open-Meteo JSON and present in a friendly format
