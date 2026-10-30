// Package mcpserver implements the MCP tool definitions shared by every
// position, mirroring backend/app/mcp_server.py.
//
// P4 (ADR-0002 §3): tool implementations on the official Go SDK
// (github.com/modelcontextprotocol/go-sdk), input schemas frozen to the
// versioned contract of ADR-0001 D1, structured errors with next steps, and
// an audit record on every tools/call. The per-position mount, credential
// wall and visibility live in internal/mcproles.
package mcpserver
