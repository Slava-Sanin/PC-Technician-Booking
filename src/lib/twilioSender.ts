import { supabase } from './supabase';

export async function sendSMS(
  phone: string, 
  message: string
): Promise<{ success: boolean; error?: string }> {
  try {
    let formattedPhone = phone.replace(/\D/g, '');
    if (!formattedPhone.startsWith('+')) {
      formattedPhone = '+' + formattedPhone;
    }

    const { data, error } = await supabase.functions.invoke('send-sms', {
      body: {
        phone: formattedPhone,
        message
      }
    });

    if (error) {
      console.error('Supabase function error:', error);
      return { 
        success: false, 
        error: error.message || 'Failed to invoke SMS function. Make sure the Edge Function is deployed.'
      };
    }

    if (data?.error) {
      console.error('SMS API error:', data);
      return { 
        success: false, 
        error: data.details || data.error || 'Failed to send SMS'
      };
    }

    if (data?.success || data?.messageId) {
      return { success: true };
    }

    console.warn('Unexpected response format:', data);
    return { 
      success: false, 
      error: 'Unexpected response from SMS service'
    };
  } catch (error) {
    console.error('SMS sending exception:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}