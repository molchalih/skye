// What Vite's client types declare for a worker imported as a URL; the consumer type check reads the app as written.
declare module "*?worker&url" {
  const url: string;
  export default url;
}
