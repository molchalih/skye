// Places along the latitude, from the Arctic to the Antarctic Circle, spread over every continent. Dragging the
// latitude holds on each one for a moment, and the sentence names it in brackets.

/** A place and the latitude it stands at. */
export interface Place {
  readonly latitude: number;
  readonly name: string;
}

export const PLACES: readonly Place[] = [
  { latitude: 66, name: "Arctic Circle" },
  { latitude: 64.15, name: "Reykjavík" },
  { latitude: 61.22, name: "Anchorage" },
  { latitude: 59.91, name: "Oslo" },
  { latitude: 55.95, name: "Edinburgh" },
  { latitude: 53.35, name: "Dublin" },
  { latitude: 52.37, name: "Amsterdam" },
  { latitude: 51.51, name: "London" },
  { latitude: 48.86, name: "Paris" },
  { latitude: 47.61, name: "Seattle" },
  { latitude: 45.5, name: "Montréal" },
  { latitude: 43.07, name: "Sapporo" },
  { latitude: 41.9, name: "Rome" },
  { latitude: 41.01, name: "Istanbul" },
  { latitude: 40.71, name: "New York" },
  { latitude: 39.9, name: "Beijing" },
  { latitude: 38.72, name: "Lisbon" },
  { latitude: 37.77, name: "San Francisco" },
  { latitude: 35.68, name: "Tokyo" },
  { latitude: 35.01, name: "Kyoto" },
  { latitude: 34.05, name: "Los Angeles" },
  { latitude: 31.23, name: "Shanghai" },
  { latitude: 30.04, name: "Cairo" },
  { latitude: 28.61, name: "Delhi" },
  { latitude: 25.76, name: "Miami" },
  { latitude: 25.2, name: "Dubai" },
  { latitude: 23.11, name: "Havana" },
  { latitude: 22.32, name: "Hong Kong" },
  { latitude: 19.07, name: "Mumbai" },
  { latitude: 14.69, name: "Dakar" },
  { latitude: 13.76, name: "Bangkok" },
  { latitude: 9.03, name: "Addis Ababa" },
  { latitude: 6.52, name: "Lagos" },
  { latitude: 1.35, name: "Singapore" },
  { latitude: -0.18, name: "Quito" },
  { latitude: -1.29, name: "Nairobi" },
  { latitude: -6.21, name: "Jakarta" },
  { latitude: -12.05, name: "Lima" },
  { latitude: -18.88, name: "Antananarivo" },
  { latitude: -22.91, name: "Rio de Janeiro" },
  { latitude: -24.6, name: "Atacama" },
  { latitude: -26.2, name: "Johannesburg" },
  { latitude: -33.45, name: "Santiago" },
  { latitude: -33.87, name: "Sydney" },
  { latitude: -34.6, name: "Buenos Aires" },
  { latitude: -36.85, name: "Auckland" },
  { latitude: -37.81, name: "Melbourne" },
  { latitude: -41.29, name: "Wellington" },
  { latitude: -42.88, name: "Hobart" },
  { latitude: -54.8, name: "Ushuaia" },
  { latitude: -66, name: "Antarctic Circle" },
];

/** Every place's latitude, ascending: where a latitude drag holds. */
export const PLACE_LATITUDES: readonly number[] = PLACES.map((place) => place.latitude).sort(
  (a, b) => a - b,
);

/** The place at exactly `latitude`, or "". */
export function placeAt(latitude: number): string {
  return PLACES.find((place) => place.latitude === latitude)?.name ?? "";
}
