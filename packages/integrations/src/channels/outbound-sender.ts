import type { NormalizedOutboundMessage } from "@support/shared-schemas";
import { buildOutboundEmailProviderRequest } from "./email-outbound-adapter.js";
import { buildOutboundWhatsAppProviderRequest } from "./whatsapp-outbound-adapter.js";

/**
 * Channel-delivery boundary for outbound messages. The send activity resolves
 * the tenant channel row and provider credential, then hands this port the
 * validated normalized message. Implementations must be side-effect free on
 * failure: a `failed` result means nothing was delivered and the caller
 * decides whether the send is retried (BACKEND_SPEC §4.3: outbound failure
 * keeps the ticket in an actionable state).
 */
export interface OutboundSendRequest {
  readonly message: NormalizedOutboundMessage;
  /** The tenant channel's `config` jsonb row (never holds plaintext secrets). */
  readonly channelConfig: Record<string, unknown>;
  /** Provider credential resolved from the config's secret reference. */
  readonly credential: string | null;
}

export interface OutboundSendSuccess {
  readonly status: "sent";
  readonly provider_message_id: string | null;
}

export interface OutboundSendFailure {
  readonly status: "failed";
  readonly error_code: string;
  readonly error_message: string;
  /** Transport/5xx failures may be retried; config/4xx failures may not. */
  readonly retryable: boolean;
}

export type OutboundSendResult = OutboundSendSuccess | OutboundSendFailure;

export interface OutboundChannelSender {
  send(request: OutboundSendRequest): Promise<OutboundSendResult>;
}

export interface HttpOutboundChannelSenderOptions {
  /** Injectable fetch so tests can assert provider requests without network. */
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_MAILGUN_API_BASE_URL = "https://api.mailgun.net";
const DEFAULT_WHATSAPP_API_BASE_URL = "https://graph.facebook.com/v20.0";

function readConfigString(
  config: Record<string, unknown>,
  key: string,
): string | null {
  const value = config[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function configFailure(message: string): OutboundSendFailure {
  return {
    status: "failed",
    error_code: "channel_config_invalid",
    error_message: message,
    retryable: false,
  };
}

/**
 * HTTP outbound sender for the supported providers: `mailgun` email sends and
 * `whatsapp_cloud` text sends. Unknown providers fail non-retryably so the
 * workflow routes the ticket back to a human instead of spinning on retries.
 */
export function createHttpOutboundChannelSender(
  options: HttpOutboundChannelSenderOptions = {},
): OutboundChannelSender {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async send(request) {
      const provider = request.message.provider;

      if (request.credential === null) {
        return {
          status: "failed",
          error_code: "credential_missing",
          error_message: `No send credential resolved for provider "${provider}".`,
          retryable: false,
        };
      }

      try {
        if (request.message.channel === "email" && provider === "mailgun") {
          return await sendMailgunEmail(fetchImpl, request);
        }

        if (
          request.message.channel === "whatsapp" &&
          provider === "whatsapp_cloud"
        ) {
          return await sendWhatsAppCloudMessage(fetchImpl, request);
        }

        return {
          status: "failed",
          error_code: "unsupported_provider",
          error_message: `No outbound sender is registered for channel "${request.message.channel}" provider "${provider}".`,
          retryable: false,
        };
      } catch (error) {
        return {
          status: "failed",
          error_code: "provider_transport_error",
          error_message: error instanceof Error ? error.message : String(error),
          retryable: true,
        };
      }
    },
  };
}

async function sendMailgunEmail(
  fetchImpl: typeof fetch,
  request: OutboundSendRequest,
): Promise<OutboundSendResult> {
  const sendingDomain = readConfigString(
    request.channelConfig,
    "sending_domain",
  );
  const fromAddress = readConfigString(request.channelConfig, "from_address");

  if (!sendingDomain || !fromAddress) {
    return configFailure(
      "Mailgun channel config requires sending_domain and from_address.",
    );
  }

  const providerRequest = buildOutboundEmailProviderRequest(request.message, {
    fromAddress,
    fromName: readConfigString(request.channelConfig, "from_name"),
  });

  const body = new URLSearchParams();
  body.set("from", providerRequest.from);
  body.set("to", providerRequest.to);
  body.set("text", providerRequest.text);
  if (providerRequest.subject !== null) {
    body.set("subject", providerRequest.subject);
  }
  if (providerRequest.html !== null) {
    body.set("html", providerRequest.html);
  }
  if (providerRequest.in_reply_to !== null) {
    body.set("h:In-Reply-To", providerRequest.in_reply_to);
  }
  if (providerRequest.references !== null) {
    body.set("h:References", providerRequest.references);
  }

  const baseUrl =
    readConfigString(request.channelConfig, "api_base_url") ??
    DEFAULT_MAILGUN_API_BASE_URL;
  const response = await fetchImpl(`${baseUrl}/v3/${sendingDomain}/messages`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`api:${request.credential}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  return providerResultFromResponse(response, (payload) =>
    typeof payload?.id === "string" ? payload.id : null,
  );
}

async function sendWhatsAppCloudMessage(
  fetchImpl: typeof fetch,
  request: OutboundSendRequest,
): Promise<OutboundSendResult> {
  const phoneNumberId = readConfigString(
    request.channelConfig,
    "phone_number_id",
  );

  if (!phoneNumberId) {
    return configFailure(
      "WhatsApp Cloud channel config requires phone_number_id.",
    );
  }

  const providerRequest = buildOutboundWhatsAppProviderRequest(request.message);
  const baseUrl =
    readConfigString(request.channelConfig, "api_base_url") ??
    DEFAULT_WHATSAPP_API_BASE_URL;
  const response = await fetchImpl(`${baseUrl}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${request.credential}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(providerRequest),
  });

  return providerResultFromResponse(response, (payload) => {
    const messages = payload?.messages;
    const first = Array.isArray(messages) ? messages[0] : null;
    const id =
      first && typeof first === "object"
        ? (first as Record<string, unknown>).id
        : null;
    return typeof id === "string" ? id : null;
  });
}

async function providerResultFromResponse(
  response: Response,
  extractProviderMessageId: (
    payload: Record<string, unknown> | null,
  ) => string | null,
): Promise<OutboundSendResult> {
  const payload = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;

  if (!response.ok) {
    return {
      status: "failed",
      error_code: `provider_http_${response.status}`,
      error_message:
        payload !== null
          ? JSON.stringify(payload).slice(0, 512)
          : `Provider responded with HTTP ${response.status}.`,
      retryable: response.status >= 500,
    };
  }

  return {
    status: "sent",
    provider_message_id: extractProviderMessageId(payload),
  };
}

/**
 * Recording sender for tests and offline development. Captures every send and
 * returns the queued results in order (defaulting to a deterministic success),
 * so callers can assert both delivery payloads and failure handling.
 */
export function createRecordingOutboundChannelSender(
  results: readonly OutboundSendResult[] = [],
): OutboundChannelSender & {
  readonly sends: OutboundSendRequest[];
} {
  const sends: OutboundSendRequest[] = [];
  const queue = [...results];

  return {
    sends,
    async send(request) {
      sends.push(request);
      return (
        queue.shift() ?? {
          status: "sent",
          provider_message_id: `provider-out-${sends.length}`,
        }
      );
    },
  };
}
