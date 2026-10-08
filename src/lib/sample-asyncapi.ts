export const sampleAsyncApi = `asyncapi: 3.0.0
info:
  title: Pet adoption events
  version: 1.0.0
  description: Adoption request and confirmation messages for the pet workflow
channels:
  adoptionRequest:
    address: pets/adoption/request
    title: Adoption request
    messages:
      request.message:
        payload:
          type: object
          required:
            - petId
          properties:
            petId:
              type: string
            requestId:
              type: string
  adoptionConfirmed:
    address: pets/adoption/confirmed
    title: Adoption confirmation
    messages:
      confirm.message:
        payload:
          type: object
          required:
            - status
          properties:
            status:
              type: string
              enum:
                - confirmed
                - rejected
            petId:
              type: string
            confirmedAt:
              type: string
              format: date-time
operations:
  requestAdoption:
    action: send
    summary: Publish an adoption request
    channel:
      $ref: '#/channels/adoptionRequest'
    messages:
      - $ref: '#/channels/adoptionRequest/messages/request.message'
  confirmAdoption:
    action: receive
    summary: Receive the adoption confirmation
    channel:
      $ref: '#/channels/adoptionConfirmed'
    messages:
      - $ref: '#/channels/adoptionConfirmed/messages/confirm.message'
`;
