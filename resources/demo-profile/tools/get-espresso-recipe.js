async function get_espresso_recipe(params) {
  // Validate input
  const roast_types = ["light", "medium", "dark"];
  if (!roast_types.includes(params.roast_type)) {
    throw new Error(`Invalid roast_type: ${params.roast_type}. Must be one of: ${roast_types.join(", ")}`);
  }

  // Base recipe parameters
  const baseRecipes = {
    light: {
      grind_size: "fine",
      dose: 18,
      yield: 36,
      time_seconds: 28,
      temperature: 93
    },
    medium: {
      grind_size: "medium-fine", 
      dose: 19,
      yield: 38,
      time_seconds: 30,
      temperature: 92
    },
    dark: {
      grind_size: "medium",
      dose: 20,
      yield: 40,
      time_seconds: 32,
      temperature: 91
    }
  };

  // Pick random recipe variation (±10% randomization)
  const recipe = baseRecipes[params.roast_type];
  const variation = {
    dose: Math.round(recipe.dose * (0.9 + Math.random() * 0.2)),
    yield: Math.round(recipe.yield * (0.9 + Math.random() * 0.2)), 
    time_seconds: Math.round(recipe.time_seconds * (0.92 + Math.random() * 0.16)),
    temperature: Math.round(recipe.temperature * (0.99 + Math.random() * 0.02))
  };

  // Generate random recipe name
  const adjectives = ["Perfect", "Ultimate", "Classic", "Pro", "Artisan", "Barista"];
  const names = ["Espresso", "Ristretto", "Lungo"];
  const randomName = `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${names[Math.floor(Math.random() * names.length)]}`;

  return {
    recipe_name: randomName,
    roast_type: params.roast_type,
    grind_size: recipe.grind_size,
    dose_grams: variation.dose,
    yield_grams: variation.yield,
    extraction_time_seconds: variation.time_seconds,
    temperature_celsius: variation.temperature,
    notes: `Randomized shot for ${params.roast_type} roast. Dial in by taste.`
  };
}


