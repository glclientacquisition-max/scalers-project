// Parses and executes every exported Supabase Auth template with Go's
// html/template, the engine Supabase Auth uses, and fails if a template does
// not parse, leaves an unrendered action, or loses its link or code.
//
//	go run supabase-auth/check/main.go supabase-auth
package main

import (
	"bytes"
	"fmt"
	"html/template"
	"os"
	"path/filepath"
	"strings"
)

func main() {
	dir := "supabase-auth"
	if len(os.Args) > 1 {
		dir = os.Args[1]
	}
	data := map[string]any{
		"ConfirmationURL": "https://example.supabase.co/auth/v1/verify?token=abc&type=signup&redirect_to=https://app.scalers.co.ke/auth/callback",
		"Token":           "482913",
		"TokenHash":       "hash123",
		"SiteURL":         "https://app.scalers.co.ke",
		"RedirectTo":      "https://app.scalers.co.ke/auth/callback",
		"Email":           "owner@example.com",
		"NewEmail":        "new@example.com",
		"Data":            map[string]any{},
	}
	files, _ := filepath.Glob(filepath.Join(dir, "*.html"))
	if len(files) == 0 {
		fmt.Println("no templates found in", dir)
		os.Exit(1)
	}
	failed := false
	for _, f := range files {
		src, err := os.ReadFile(f)
		if err != nil {
			panic(err)
		}
		t, err := template.New(filepath.Base(f)).Parse(string(src))
		if err != nil {
			fmt.Printf("FAIL %s: parse: %v\n", f, err)
			failed = true
			continue
		}
		var out bytes.Buffer
		if err := t.Execute(&out, data); err != nil {
			fmt.Printf("FAIL %s: execute: %v\n", f, err)
			failed = true
			continue
		}
		html := out.String()
		problems := []string{}
		if strings.Contains(html, "ZgotmplZ") {
			problems = append(problems, "html/template rejected a value (ZgotmplZ)")
		}
		if !strings.Contains(html, "prefers-color-scheme") {
			problems = append(problems, "head CSS lost")
		}
		if strings.Contains(html, "{{") {
			problems = append(problems, "unrendered action")
		}
		if strings.Contains(filepath.Base(f), "reauthentication") {
			if !strings.Contains(html, "482913") {
				problems = append(problems, "code missing")
			}
		} else if strings.Contains(filepath.Base(f), "reset-password") {
			// Any-device reset link: Desk's /auth/callback verifies the token hash.
			if !strings.Contains(html, `href="https://app.scalers.co.ke/auth/callback?next=/reset-password&amp;token_hash=hash123&amp;type=recovery"`) {
				problems = append(problems, "token hash reset link missing from href")
			}
		} else if !strings.Contains(html, `href="https://example.supabase.co/auth/v1/verify?token=abc&amp;type=signup`) {
			problems = append(problems, "confirmation link missing from href")
		}
		if !strings.Contains(html, "If you didn&#x27;t ask for this") && !strings.Contains(html, "If you didn&#39;t ask for this") && !strings.Contains(html, "If you didn't ask for this") {
			problems = append(problems, "security line missing")
		}
		if len(problems) > 0 {
			fmt.Printf("FAIL %s: %s\n", f, strings.Join(problems, ", "))
			failed = true
			continue
		}
		fmt.Printf("ok   %s (%d bytes rendered)\n", filepath.Base(f), len(html))
	}
	if failed {
		os.Exit(1)
	}
}
