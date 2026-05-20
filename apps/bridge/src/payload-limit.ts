import {
  BRIDGE_HARD_PAYLOAD_BYTE_LIMIT,
  BRIDGE_PAYLOAD_TOO_LARGE_CODE,
  BRIDGE_PAYLOAD_TOO_LARGE_MESSAGE,
  PROTOCOL_VERSION,
  exceedsPayloadByteLimit,
  serializedJsonByteLength
} from "@sidra/protocol";

export { BRIDGE_HARD_PAYLOAD_BYTE_LIMIT, exceedsPayloadByteLimit, serializedJsonByteLength };

export const payloadTooLargeError = {
  type: "bridge.error",
  version: PROTOCOL_VERSION,
  message: BRIDGE_PAYLOAD_TOO_LARGE_MESSAGE,
  code: BRIDGE_PAYLOAD_TOO_LARGE_CODE
} as const;
