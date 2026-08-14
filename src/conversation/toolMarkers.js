// Parse ###TOOL### / ###ENDCALL### markers from Gemini voice responses.

/**
 * @param {string} responseText
 */
function parseGeminiResponse(responseText) {
  const output = {
    spokenText: responseText,
    shouldEndCall: false,
    name: null,
    reason: null,
    escalate: null,
    serviceRequest: null,
    appointment: null,
    appointmentUpdate: null,
    errors: [],
  };
  let spoken = String(responseText || '');
  const toolRe = /###TOOL###([\s\S]*?)###ENDTOOL###/gi;
  const blocks = [...spoken.matchAll(toolRe)];

  for (const match of blocks) {
    const toolJson = match[1].trim();
    try {
      const parsed = JSON.parse(toolJson);
      if (parsed.save_caller_info) {
        if (parsed.save_caller_info.name != null) {
          output.name = parsed.save_caller_info.name;
        }
        if (parsed.save_caller_info.reason != null) {
          output.reason = parsed.save_caller_info.reason;
        }
      }
      if (parsed.escalate) {
        output.escalate = {
          teammate: String(
            parsed.escalate.teammate ||
              parsed.escalate.to ||
              parsed.escalate.role ||
              ''
          ).trim(),
          name: String(parsed.escalate.name || '').trim(),
          reason: String(parsed.escalate.reason || '').trim(),
        };
      }
      if (parsed.create_service_request) {
        const req = parsed.create_service_request;
        output.serviceRequest = {
          type: String(req.type || req.request_type || 'enquiry').trim(),
          name: String(req.name || '').trim(),
          phone: String(req.phone || '').trim(),
          item: String(req.item || req.product || '').trim(),
          quantity: String(req.quantity || req.qty || '').trim(),
          whenText: String(req.when_text || req.when || req.pickup || '').trim(),
          notes: String(req.notes || req.reason || '').trim(),
        };
        // Mirror into save_caller_info fields when missing.
        if (!output.name && output.serviceRequest.name) {
          output.name = output.serviceRequest.name;
        }
        if (!output.reason) {
          const bits = [
            output.serviceRequest.type,
            output.serviceRequest.item,
            output.serviceRequest.whenText,
          ].filter(Boolean);
          if (bits.length) output.reason = bits.join(' — ');
        }
      }
      if (parsed.create_appointment) {
        const appt = parsed.create_appointment;
        output.appointment = {
          serviceName: String(
            appt.service_name || appt.service || appt.item || ''
          ).trim(),
          name: String(appt.name || '').trim(),
          phone: String(appt.phone || '').trim(),
          whenText: String(
            appt.when_text || appt.when || appt.time_window || ''
          ).trim(),
          landmark: String(
            appt.landmark || appt.address_landmark || appt.address || ''
          ).trim(),
          notes: String(appt.notes || appt.reason || '').trim(),
          windowStart: String(appt.window_start || '').trim(),
          windowEnd: String(appt.window_end || '').trim(),
        };
        if (!output.name && output.appointment.name) {
          output.name = output.appointment.name;
        }
        if (!output.reason) {
          const bits = [
            'visit',
            output.appointment.serviceName,
            output.appointment.whenText,
            output.appointment.landmark,
          ].filter(Boolean);
          if (bits.length) output.reason = bits.join(' — ');
        }
      }
      if (parsed.update_appointment) {
        const appt = parsed.update_appointment;
        output.appointmentUpdate = {
          appointmentId: String(appt.id || appt.appointment_id || '').trim(),
          status: String(appt.status || '').trim(),
          whenText: String(
            appt.when_text || appt.when || appt.time_window || ''
          ).trim(),
          landmark: String(
            appt.landmark || appt.address_landmark || appt.address || ''
          ).trim(),
          notes: String(appt.notes || appt.reason || '').trim(),
          serviceName: String(
            appt.service_name || appt.service || ''
          ).trim(),
          phone: String(appt.phone || '').trim(),
          windowStart: String(appt.window_start || '').trim(),
          windowEnd: String(appt.window_end || '').trim(),
        };
      }
    } catch (err) {
      output.errors.push({
        type: 'invalid_tool_json',
        message: String(err?.message || err),
      });
      console.warn(
        '[parseGeminiResponse] Failed to parse tool JSON:',
        err?.message || err
      );
    }
    spoken = spoken.replace(match[0], '');
  }

  output.spokenText = spoken.trim();

  if (/###ENDCALL###/i.test(output.spokenText)) {
    output.shouldEndCall = true;
    output.spokenText = output.spokenText.replace(/###ENDCALL###/gi, '').trim();
  }

  return output;
}

module.exports = { parseGeminiResponse };
