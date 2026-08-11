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
    } catch (err) {
      console.warn(
        '[parseGeminiResponse] Failed to parse tool JSON:',
        err?.message || err
      );
    }
    spoken = spoken.replace(match[0], '');
  }

  output.spokenText = spoken.trim();

  const endCallMatch = /###ENDCALL###/i.exec(output.spokenText);
  if (endCallMatch) {
    output.shouldEndCall = true;
    output.spokenText = output.spokenText.replace(endCallMatch[0], '').trim();
  }

  return output;
}

module.exports = { parseGeminiResponse };
