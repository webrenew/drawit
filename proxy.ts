/**
 * Next.js Proxy (formerly Middleware)
 *
 * Provides:
 * - Security headers (CSP, X-Frame-Options, etc.)
 * - Rate limiting for API routes
 * - Request logging for auditing
 */

import { NextResponse, type NextRequest } from "next/server"

// ============================================
// RATE LIMITING
// ============================================

interface RateLimitRecord {
  count: number
  resetTime: number
}

// In-memory rate limit store
// Note: In production with multiple instances, use Redis or similar
const rateLimitStore = new Map<string, RateLimitRecord>()

// Rate limit configuration
const RATE_LIMIT_CONFIG = {
  // API routes - more restrictive
  api: {
    limit: 60,           // requests per window
    windowMs: 60 * 1000, // 1 minute
  },
  // AI endpoints - most restrictive (expensive operations)
  aiApi: {
    limit: 20,           // requests per window
    windowMs: 60 * 1000, // 1 minute
  },
}

/**
 * Check if request should be rate limited
 * Returns true if request is allowed, false if rate limited
 */
function checkRateLimit(
  identifier: string, 
  config: { limit: number; windowMs: number }
): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now()
  const record = rateLimitStore.get(identifier)
  
  // No existing record or window expired - create new
  if (!record || now > record.resetTime) {
    rateLimitStore.set(identifier, { 
      count: 1, 
      resetTime: now + config.windowMs 
    })
    return { 
      allowed: true, 
      remaining: config.limit - 1, 
      resetIn: config.windowMs 
    }
  }
  
  // Check if over limit
  if (record.count >= config.limit) {
    return { 
      allowed: false, 
      remaining: 0, 
      resetIn: record.resetTime - now 
    }
  }
  
  // Increment count
  record.count++
  return { 
    allowed: true, 
    remaining: config.limit - record.count, 
    resetIn: record.resetTime - now 
  }
}

/**
 * Clean up expired rate limit records (prevent memory leak)
 * Called periodically
 */
function cleanupRateLimitStore(): void {
  const now = Date.now()
  for (const [key, record] of rateLimitStore.entries()) {
    if (now > record.resetTime) {
      rateLimitStore.delete(key)
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupRateLimitStore, 5 * 60 * 1000)

// ============================================
// SECURITY HEADERS
// ============================================

/**
 * Content Security Policy
 * Restricts resource loading to prevent XSS and data injection
 */
function getCSPHeader(): string {
  const directives = [
    // Default: only allow from same origin
    "default-src 'self'",
    
    // Scripts: self + inline (needed for Next.js) + eval (needed for some libs)
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vercel.live",
    
    // Styles: self + inline (needed for styled-components, Tailwind)
    "style-src 'self' 'unsafe-inline'",
    
    // Images: self + data URLs + blob + external image hosts
    "img-src 'self' data: blob: https: http:",
    
    // Fonts: self + Google Fonts
    "font-src 'self' https://fonts.gstatic.com",
    
    // Connect: API calls to self + Supabase + Vercel
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.vercel.com https://vercel.live wss://ws-us3.pusher.com",
    
    // Frames: deny embedding (clickjacking protection)
    "frame-ancestors 'none'",
    
    // Form submissions: only to self
    "form-action 'self'",
    
    // Base URI: only self
    "base-uri 'self'",
    
    // Object/embed: none (Flash, etc.)
    "object-src 'none'",
    
    // Upgrade insecure requests in production
    "upgrade-insecure-requests",
  ]
  
  return directives.join("; ")
}

/**
 * Apply security headers to response
 */
function applySecurityHeaders(response: NextResponse): void {
  // Content Security Policy
  response.headers.set("Content-Security-Policy", getCSPHeader())
  
  // Prevent clickjacking
  response.headers.set("X-Frame-Options", "DENY")
  
  // Prevent MIME type sniffing
  response.headers.set("X-Content-Type-Options", "nosniff")
  
  // Control referrer information
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
  
  // XSS protection (legacy browsers)
  response.headers.set("X-XSS-Protection", "1; mode=block")
  
  // DNS prefetch control
  response.headers.set("X-DNS-Prefetch-Control", "on")
  
  // Permissions Policy (formerly Feature-Policy)
  response.headers.set(
    "Permissions-Policy", 
    "camera=(), microphone=(), geolocation=(), interest-cohort=()"
  )
  
  // HSTS - enforce HTTPS (only in production)
  if (process.env.NODE_ENV === "production") {
    response.headers.set(
      "Strict-Transport-Security", 
      "max-age=63072000; includeSubDomains; preload"
    )
  }
}

// ============================================
// MIDDLEWARE
// ============================================

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const response = NextResponse.next()
  
  // Apply security headers to all responses
  applySecurityHeaders(response)
  
  // Rate limiting for API routes
  if (pathname.startsWith("/api/")) {
    // Get client identifier (IP address)
    const forwardedFor = request.headers.get("x-forwarded-for")
    const ip = forwardedFor?.split(",")[0]?.trim() ?? "unknown"
    const identifier = `${ip}:${pathname}`
    
    // Use stricter limits for AI endpoints
    const isAiEndpoint = pathname.startsWith("/api/ai-chat") || 
                         pathname.startsWith("/api/ai-diagram")
    const config = isAiEndpoint ? RATE_LIMIT_CONFIG.aiApi : RATE_LIMIT_CONFIG.api
    
    const { allowed, remaining, resetIn } = checkRateLimit(identifier, config)
    
    // Add rate limit headers
    response.headers.set("X-RateLimit-Limit", config.limit.toString())
    response.headers.set("X-RateLimit-Remaining", remaining.toString())
    response.headers.set("X-RateLimit-Reset", Math.ceil(resetIn / 1000).toString())
    
    if (!allowed) {
      console.warn(`[middleware] Rate limit exceeded for ${ip} on ${pathname}`)
      
      return new NextResponse(
        JSON.stringify({ 
          error: "Too many requests", 
          message: "Please wait before making more requests",
          retryAfter: Math.ceil(resetIn / 1000)
        }),
        { 
          status: 429, 
          headers: {
            "Content-Type": "application/json",
            "Retry-After": Math.ceil(resetIn / 1000).toString(),
            "X-RateLimit-Limit": config.limit.toString(),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": Math.ceil(resetIn / 1000).toString(),
          }
        }
      )
    }
  }
  
  return response
}

// ============================================
// MATCHER CONFIG
// ============================================

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - Public assets (images, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
}





