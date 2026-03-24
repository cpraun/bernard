/**
 * Dummy implementation of the get_weather tool.
 * In a real app, this would fetch data from an API like OpenWeatherMap.
 */
async function getWeather({ location, unit = 'celsius' }) {
  console.log(`Fetching weather for: ${location} in ${unit}...`);

  // Simulated logic: 
  // We'll return a fixed temperature based on the unit
  const temp = unit === 'celsius' ? 22 : 72;

  return {
    location: location,
    temperature: temp,
    unit: unit,
    condition: "Partly Cloudy"
  };
}
