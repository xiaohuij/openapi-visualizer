export const sampleArazzo = `arazzo: 1.1.0
info:
  title: Pet adoption workflow
  version: 1.0.0
  description: List available pets, mark one as adopted, and confirm the adoption asynchronously
sourceDescriptions:
  - name: petstore
    type: openapi
    url: modern-petstore-3.2.openapi.yaml
  - name: events
    type: asyncapi
    url: sample-pet-events.asyncapi.yaml
workflows:
  - workflowId: adoptPet
    summary: Adopt an available pet
    steps:
      - stepId: listPets
        description: List available pets
        operationId: $sourceDescriptions.petstore.listPets
        parameters:
          - name: limit
            in: query
            value: 10
        successCriteria:
          - condition: $statusCode == 200
        outputs:
          firstPetId:
            type: jsonpath
            context: $response.body
            selector: $[0].id
      - stepId: updatePet
        description: Mark the selected pet as adopted
        operationPath: '{$sourceDescriptions.petstore.url}#/paths/~1pets~1{id}/put'
        dependsOn:
          - listPets
        parameters:
          - name: petId
            in: path
            value: $steps.listPets.outputs.firstPetId
  - workflowId: confirmAdoption
    summary: Publish the adoption request and wait for broker confirmation
    inputs:
      type: object
      required:
        - requestId
        - petId
      properties:
        requestId:
          type: string
        petId:
          type: string
    steps:
      - stepId: requestAdoption
        description: Publish the adoption request event
        operationId: $sourceDescriptions.events.requestAdoption
        action: send
        requestBody:
          contentType: application/json
          payload:
            petId: $inputs.petId
            requestId: $inputs.requestId
      - stepId: confirmAdoptionEvent
        description: Receive the broker confirmation on the adoption channel
        channelPath: '{$sourceDescriptions.events.url}#/channels/adoptionConfirmed'
        action: receive
        correlationId: $inputs.requestId
        timeout: 6000
        dependsOn:
          - requestAdoption
        successCriteria:
          - condition: $message.payload.status == confirmed
        outputs:
          confirmedPetId: $message.payload.petId
`;
