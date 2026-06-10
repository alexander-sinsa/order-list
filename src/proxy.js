import { NextResponse } from 'next/server';

export function proxy(request) {
  const password = process.env.APP_PASSWORD;

  // If no password is set in .env, bypass protection
  if (!password || password.trim() === "") {
    return NextResponse.next();
  }

  const authorizationHeader = request.headers.get('authorization');

  if (authorizationHeader) {
    try {
      const auth = authorizationHeader.split(' ')[1];
      const decoded = atob(auth);
      const [user, pass] = decoded.split(':');

      // Verify password (username can be anything)
      if (pass === password) {
        return NextResponse.next();
      }
    } catch (e) {
      console.error("Failed to parse basic auth credentials:", e.message);
    }
  }

  // Request credentials
  return new NextResponse('Authentication Required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Secure VTEX Tracker Area"',
    },
  });
}

// Exclude public webhooks and assets from authentication
export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - api/vtex-webhook (webhook receiver endpoint for VTEX)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - logo or image files (png, svg, jpg)
     */
    '/((?!api/vtex-webhook|_next/static|_next/image|favicon.ico|.*\\.svg$|.*\\.png$).*)',
  ],
};
