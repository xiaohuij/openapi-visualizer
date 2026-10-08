export const sampleArazzo = `arazzo: 1.1.0
info:
  title: Pet adoption workflow
  version: 1.0.0
  description: List available pets and mark one as adopted
sourceDescriptions:
  - name: petstore
    type: openapi
    url: modern-petstore-3.2.openapi.yaml
workflows:
  - workflowId: adoptPet
    summary: Adopt an available pet
    steps:
      - stepId: listPets
        description: List available pets
        operationId: listPets
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
        operationId: updatePet
        dependsOn:
          - listPets
        parameters:
          - name: petId
            in: path
            value: $steps.listPets.outputs.firstPetId
`;
