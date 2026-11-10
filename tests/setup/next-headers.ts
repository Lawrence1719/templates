// Stand-in for next/headers: serves the headers of the request the
// test client is currently making (see TestClient.call).
import { requestHeaders } from "./request-context"

export async function headers() {
  return requestHeaders.current
}

export async function cookies() {
  return { get: () => undefined, getAll: () => [], has: () => false, set() {}, delete() {} }
}
