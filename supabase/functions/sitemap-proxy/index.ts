const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

/**
 * Validate if a URL is safe to fetch (not local or private network)
 */
function validateUrl(urlString: string): { isValid: boolean; error?: string } {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase();

    // Check for localhost variations
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return { isValid: false, error: 'Access to localhost is not allowed' };
    }

    // Check for private IP ranges
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const ipv4Match = hostname.match(ipv4Regex);
    
    if (ipv4Match) {
      const [, a, b, c, d] = ipv4Match.map(Number);
      
      // Check private IP ranges
      if (
        (a === 10) || // 10.0.0.0/8
        (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
        (a === 192 && b === 168) || // 192.168.0.0/16
        (a === 169 && b === 254) || // 169.254.0.0/16 (link-local)
        (a === 127) // 127.0.0.0/8 (loopback)
      ) {
        return { isValid: false, error: 'Access to private IP addresses is not allowed' };
      }
    }

    // Only allow HTTP and HTTPS protocols
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { isValid: false, error: 'Only HTTP and HTTPS protocols are allowed' };
    }

    return { isValid: true };
  } catch (error) {
    return { isValid: false, error: 'Invalid URL format' };
  }
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    // Get the site URL from the query parameter
    const url = new URL(req.url);
    const siteUrl = url.searchParams.get("url");

    if (!siteUrl) {
      return new Response(
        JSON.stringify({ error: "Missing site URL parameter" }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // Validate the site URL
    const validation = validateUrl(siteUrl);
    if (!validation.isValid) {
      return new Response(
        JSON.stringify({ error: validation.error }),
        {
          status: 403,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // Construct the sitemap URL
    const sitemapUrl = `${siteUrl.replace(/\/$/, "")}/sitemap.xml`;
    console.log(`Fetching sitemap from: ${sitemapUrl}`);

    // Validate the constructed URL as well
    const sitemapValidation = validateUrl(sitemapUrl);
    if (!sitemapValidation.isValid) {
      return new Response(
        JSON.stringify({ error: sitemapValidation.error }),
        {
          status: 403,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // Fetch the sitemap
    const response = await fetch(sitemapUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; KnowledgeUpdater/1.0)",
      },
    });

    if (!response.ok) {
      return new Response(
        JSON.stringify({ 
          error: `Failed to fetch sitemap: HTTP ${response.status}`,
          status: response.status 
        }),
        {
          status: response.status,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // Get the XML content
    const xmlContent = await response.text();

    // Parse the XML to extract GUIDs
    const guids = [];
    const urlRegex = /<loc>(https?:\/\/[^<]+)<\/loc>/g;
    let match;
    
    while ((match = urlRegex.exec(xmlContent)) !== null) {
      const url = match[1];
      if (url.includes("/nyhed/") || url.includes("/afgoerelse/")) {
        const guid = url.split("/").pop();
        if (guid) {
          guids.push(guid);
        }
      }
    }

    // Return the GUIDs as JSON
    return new Response(
      JSON.stringify({ guids, count: guids.length }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Error processing request:", error);
    return new Response(
      JSON.stringify({ error: error?.message || String(error) || "Unknown error occurred" }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});