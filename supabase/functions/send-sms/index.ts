declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: {
    get: (key: string) => string | undefined;
  };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
    const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
    let TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER');

    const missingVars: string[] = [];
    if (!TWILIO_ACCOUNT_SID) missingVars.push('TWILIO_ACCOUNT_SID');
    if (!TWILIO_AUTH_TOKEN) missingVars.push('TWILIO_AUTH_TOKEN');
    if (!TWILIO_PHONE_NUMBER) missingVars.push('TWILIO_PHONE_NUMBER');

    if (missingVars.length > 0) {
      console.error('Missing Twilio environment variables:', missingVars.join(', '));
      return new Response(
        JSON.stringify({ 
          error: 'Missing required Twilio environment variables',
          details: `The following environment variables are not set: ${missingVars.join(', ')}`,
          hint: 'Set these secrets in Supabase Dashboard: Settings → Edge Functions → Secrets, or use: supabase secrets set <NAME>=<VALUE>'
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    TWILIO_PHONE_NUMBER = TWILIO_PHONE_NUMBER!.trim();
    if (!TWILIO_PHONE_NUMBER.startsWith('+')) {
      TWILIO_PHONE_NUMBER = '+' + TWILIO_PHONE_NUMBER.replace(/\s+/g, '');
    }

    const requestData = await req.json();
    const { phone, message } = requestData;

    if (!phone || !message) {
      return new Response(
        JSON.stringify({ 
          error: 'Missing required parameters',
          details: 'Request is missing required fields'
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    const formData = new FormData();
    formData.append('From', TWILIO_PHONE_NUMBER);
    formData.append('To', phone);
    formData.append('Body', message);

    const twilioResponse = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: 'POST',
        body: formData,
        headers: {
          'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)
        }
      }
    );

    const twilioData = await twilioResponse.json();

    if (!twilioResponse.ok) {
      console.error('Twilio API error:', twilioData);
      const errorMessage = twilioData.message || 'Error sending SMS via Twilio';
      
      if (errorMessage.includes('not a Twilio phone number')) {
        return new Response(
          JSON.stringify({ 
            error: 'Invalid Twilio phone number',
            details: `The phone number "${TWILIO_PHONE_NUMBER}" is not a valid Twilio number. Please check your Twilio account and update the TWILIO_PHONE_NUMBER secret.`,
            hint: 'Go to Twilio Console → Phone Numbers → Manage → Active numbers to see your valid numbers.'
          }),
          { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }
      
      throw new Error(errorMessage);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        messageId: twilioData.sid,
        status: twilioData.status
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Error sending SMS:', error);
    
    return new Response(
      JSON.stringify({ 
        error: 'Failed to send SMS',
        details: error instanceof Error ? error.message : 'Unknown error',
        errorType: error instanceof Error ? error.name : 'UnknownError'
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});