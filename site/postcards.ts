// Skies worth visiting. Each sets the weather, the latitude and the moment; the lens and renderer settings stay as tuned.
// Each latitude is one of the places in places.ts, so the sentence names it.
// Solar noon is the local clock time of solar noon there on that date, so sunrise and sunset read true.

import type { SkyeParams } from "../src/index.ts";

export const POSTCARDS: readonly SkyeParams[] = [
  // Golden hour, Amsterdam
  {
    scene: "cloudy",
    cover: 0.45,
    seed: 3,
    latitude: 52.37,
    dayOfYear: 172,
    solarNoon: 13.67,
    hour: 21.3,
    moonPhase: 0.55,
  },
  // Midnight sun, Arctic Circle
  {
    scene: "clear",
    cover: 0.22,
    seed: 7,
    latitude: 66,
    dayOfYear: 172,
    solarNoon: 13.2,
    hour: 1.1,
    moonPhase: 0.3,
  },
  // Monsoon, Mumbai
  {
    scene: "rainy",
    intensity: 0.85,
    cover: 0.9,
    seed: 11,
    latitude: 19.07,
    dayOfYear: 196,
    solarNoon: 12.68,
    hour: 16.5,
    moonPhase: 0.2,
  },
  // Summer storm, Buenos Aires
  {
    scene: "storm",
    intensity: 0.8,
    cover: 0.9,
    seed: 5,
    latitude: -34.6,
    dayOfYear: 10,
    solarNoon: 13.85,
    hour: 21.9,
    moonPhase: 0.62,
  },
  // First snow, Kyoto
  {
    scene: "snowy",
    intensity: 0.45,
    cover: 0.75,
    seed: 2,
    latitude: 35.01,
    dayOfYear: 346,
    solarNoon: 11.8,
    hour: 16.4,
    moonPhase: 0.7,
  },
  // Sea fog, San Francisco
  {
    scene: "fog",
    intensity: 0.7,
    cover: 0.6,
    seed: 9,
    latitude: 37.77,
    dayOfYear: 215,
    solarNoon: 13.3,
    hour: 7.4,
    moonPhase: 0.4,
  },
  // Khamsin, Cairo
  {
    scene: "haze",
    intensity: 0.95,
    cover: 0.2,
    seed: 4,
    latitude: 30.04,
    dayOfYear: 95,
    solarNoon: 11.95,
    hour: 17.4,
    moonPhase: 0.1,
  },
  // New moon, Atacama
  {
    scene: "clear",
    cover: 0,
    seed: 1,
    latitude: -24.6,
    dayOfYear: 200,
    solarNoon: 12.75,
    hour: 0.5,
    moonPhase: 0.02,
  },
  // Sun shower, Dublin
  {
    scene: "rainy",
    intensity: 0.15,
    cover: 0.45,
    seed: 6,
    latitude: 53.35,
    dayOfYear: 110,
    solarNoon: 13.45,
    hour: 18.4,
    moonPhase: 0.45,
  },
  // Sleet at dusk, Edinburgh
  {
    scene: "sleet",
    intensity: 0.6,
    cover: 0.8,
    seed: 8,
    latitude: 55.95,
    dayOfYear: 40,
    solarNoon: 12.45,
    hour: 17.4,
    moonPhase: 0.8,
  },
  // Moonrise, Lisbon
  {
    scene: "clear",
    cover: 0.15,
    seed: 12,
    latitude: 38.72,
    dayOfYear: 250,
    solarNoon: 13.45,
    hour: 20.6,
    moonPhase: 0.5,
  },
];

/** The params a postcard replaces, so nothing of the last sky lingers in the next. */
export const STORY: SkyeParams = { intensity: 0.6, wind: undefined };
