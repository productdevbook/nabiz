import { join, normalize, sep } from "node:path"

/** The file a request names inside the built directory, or null if it
 *  names something else. Decoded before it is normalised, so "%2e%2e%2f"
 *  is the climb it is rather than a directory to look for, and compared
 *  against the directory plus a separator, so a sibling whose name begins
 *  with the same letters is not inside it. */
export function insideClient(client: string, url: string): string | null {
  let path: string
  try {
    path = decodeURIComponent(new URL(url, "http://host").pathname)
  } catch {
    return null
  }
  const asked = join(client, normalize(path))
  return asked.startsWith(client + sep) ? asked : null
}
