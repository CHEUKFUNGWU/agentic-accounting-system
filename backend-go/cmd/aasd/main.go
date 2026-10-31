// Command aasd is the composition root of the Go backend: configuration,
// wiring and lifespan. It knows everything; packages know their neighbours
// (design rule 4).
//
// P0 scaffold: no runtime behaviour yet. Layers compose here as they land —
// store adapters (P2), MCP mounts (P4), REST/SSE (P5) — per ADR-0002 §3.
package main

import "fmt"

func main() {
	fmt.Println("aasd: REQ-0035 P0 scaffold (no runtime behaviour yet)")
}
