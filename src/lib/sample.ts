export const sampleOpenApi = `openapi: 3.1.0
info:
  title: Enterprise Customer Offer API
  version: 1.4.0
  summary: A standards-based API for customer offers, qualifications, and product references
  description: |
    A representative enterprise OpenAPI document with shared schemas, reusable parameters,
    multiple HTTP methods, response models, OAuth security, webhooks, and JSON Schema composition.
servers:
  - url: https://api.example.com/customer-offering/v1
    description: Production
  - url: https://api.sandbox.example.com/customer-offering/v1
    description: Sandbox
tags:
  - name: Customer Offers
    description: Create, retrieve, and modify customer offers
  - name: Offer Qualifications
    description: Evaluate and retrieve offer qualification results
  - name: Administration
    description: Product and party reference data
security:
  - offerOAuth:
      - offers:read
paths:
  /customer-offers:
    get:
      tags: [Customer Offers]
      operationId: listCustomerOffers
      summary: List customer offers
      parameters:
        - $ref: "#/components/parameters/PageLimit"
        - $ref: "#/components/parameters/PageOffset"
        - name: status
          in: query
          required: false
          description: Filter offers by lifecycle status
          schema:
            $ref: "#/components/schemas/OfferStatus"
      responses:
        "200":
          description: A page of customer offers
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/CustomerOfferList"
              examples:
                firstPage:
                  value:
                    items: []
                    limit: 50
                    offset: 0
        "401":
          $ref: "#/components/responses/Unauthorized"
        "500":
          $ref: "#/components/responses/ServerError"
    post:
      tags: [Customer Offers]
      operationId: initiateCustomerOffer
      summary: Initiate a new customer offer
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CustomerOfferCreateRequest"
            examples:
              retailOffer:
                value:
                  customer:
                    id: party-4821
                  product:
                    id: product-912
                  currency: EUR
      responses:
        "201":
          description: Customer offer created
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/CustomerOffer"
        "400":
          $ref: "#/components/responses/BadRequest"
        "409":
          description: An active offer already exists
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"
  /customer-offers/{offerId}:
    parameters:
      - $ref: "#/components/parameters/OfferId"
    get:
      tags: [Customer Offers]
      operationId: retrieveCustomerOffer
      summary: Retrieve a customer offer
      responses:
        "200":
          description: Customer offer details
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/CustomerOffer"
        "404":
          $ref: "#/components/responses/NotFound"
    put:
      tags: [Customer Offers]
      operationId: updateCustomerOffer
      summary: Update customer offer terms or status
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CustomerOfferUpdateRequest"
      responses:
        "200":
          description: Updated customer offer
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/CustomerOffer"
        "422":
          description: The submitted offer change is not valid
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"
    delete:
      tags: [Customer Offers]
      operationId: withdrawCustomerOffer
      summary: Withdraw a customer offer
      deprecated: true
      responses:
        "204":
          description: Offer withdrawn
        "404":
          $ref: "#/components/responses/NotFound"
  /customer-offers/{offerId}/qualifications:
    parameters:
      - $ref: "#/components/parameters/OfferId"
    get:
      tags: [Offer Qualifications]
      operationId: listOfferQualifications
      summary: List qualifications evaluated for an offer
      responses:
        "200":
          description: Qualification results
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/OfferQualification"
    post:
      tags: [Offer Qualifications]
      operationId: evaluateOfferQualification
      summary: Evaluate an offer against qualification rules
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/QualificationEvaluateRequest"
      responses:
        "202":
          description: Qualification evaluation accepted
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/OfferQualification"
  /products:
    get:
      tags: [Administration]
      operationId: listProducts
      summary: List product references
      parameters:
        - name: productType
          in: query
          schema:
            type: string
            enum: [card, account, loan, bundle]
      responses:
        "200":
          description: Product references
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/ProductReference"
webhooks:
  offerStateChanged:
    post:
      operationId: notifyOfferStateChanged
      summary: Receive customer offer state notifications
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/OfferStateChangedEvent"
      responses:
        "204":
          description: Notification processed
components:
  securitySchemes:
    offerOAuth:
      type: oauth2
      flows:
        clientCredentials:
          tokenUrl: https://auth.example.com/oauth/token
          scopes:
            offers:read: Read customer offers
            offers:write: Create or modify customer offers
  parameters:
    OfferId:
      name: offerId
      in: path
      required: true
      description: Stable customer offer identifier
      schema:
        $ref: "#/components/schemas/OfferId"
    PageLimit:
      name: limit
      in: query
      required: false
      description: Maximum number of records to return
      schema:
        type: integer
        format: int32
        minimum: 1
        maximum: 200
        default: 50
    PageOffset:
      name: offset
      in: query
      required: false
      schema:
        type: integer
        format: int64
        minimum: 0
        default: 0
  responses:
    BadRequest:
      description: Invalid request
      content:
        application/problem+json:
          schema:
            $ref: "#/components/schemas/Error"
    Unauthorized:
      description: Missing or invalid credentials
      content:
        application/problem+json:
          schema:
            $ref: "#/components/schemas/Error"
    NotFound:
      description: Resource does not exist
      content:
        application/problem+json:
          schema:
            $ref: "#/components/schemas/Error"
    ServerError:
      description: Unexpected server error
      content:
        application/problem+json:
          schema:
            $ref: "#/components/schemas/Error"
  schemas:
    OfferId:
      type: string
      format: uuid
      examples: ["0f4d7d52-6d7b-4f52-a14f-9a5e4e7bc811"]
    OfferStatus:
      type: string
      enum: [draft, active, suspended, accepted, expired, withdrawn]
      default: draft
    Money:
      type: object
      required: [amount, currency]
      properties:
        amount:
          type: string
          pattern: ^-?\\d+(\\.\\d{1,4})?$
        currency:
          type: string
          minLength: 3
          maxLength: 3
    PartyReference:
      type: object
      required: [id]
      properties:
        id:
          type: string
        displayName:
          type: string
        partyType:
          type: string
          enum: [individual, organization]
    ProductReference:
      type: object
      required: [id, name, productType]
      properties:
        id:
          type: string
        name:
          type: string
        productType:
          type: string
          enum: [card, account, loan, bundle]
        terms:
          type: array
          items:
            $ref: "#/components/schemas/ProductTerm"
    ProductTerm:
      type: object
      required: [code]
      properties:
        code:
          type: string
        value:
          description: Untyped value because valid types vary by term code
        unit:
          type: string
    OfferQualification:
      type: object
      required: [id, offerId, result]
      properties:
        id:
          type: string
        offerId:
          $ref: "#/components/schemas/OfferId"
        result:
          type: string
          enum: [qualified, not_qualified, manual_review]
        reasonCodes:
          type: array
          items:
            type: string
    QualificationEvaluateRequest:
      type: object
      required: [rulesetVersion]
      properties:
        rulesetVersion:
          type: string
        properties:
          type: object
          additionalProperties: true
    CustomerOfferCreateRequest:
      allOf:
        - $ref: "#/components/schemas/CustomerOfferBase"
        - type: object
          required: [customer, product]
    CustomerOfferUpdateRequest:
      type: object
      properties:
        status:
          $ref: "#/components/schemas/OfferStatus"
        expiresAt:
          type: string
          format: date-time
        price:
          $ref: "#/components/schemas/Money"
    CustomerOfferBase:
      type: object
      required: [customer, product]
      properties:
        customer:
          $ref: "#/components/schemas/PartyReference"
        product:
          $ref: "#/components/schemas/ProductReference"
        currency:
          type: string
          minLength: 3
          maxLength: 3
        expiresAt:
          type: string
          format: date-time
    CustomerOffer:
      allOf:
        - $ref: "#/components/schemas/CustomerOfferBase"
        - type: object
          required: [id, status, createdAt]
          properties:
            id:
              $ref: "#/components/schemas/OfferId"
            status:
              $ref: "#/components/schemas/OfferStatus"
            price:
              $ref: "#/components/schemas/Money"
            qualifications:
              type: array
              items:
                $ref: "#/components/schemas/OfferQualification"
    CustomerOfferList:
      type: object
      required: [items, limit, offset]
      properties:
        items:
          type: array
          items:
            $ref: "#/components/schemas/CustomerOffer"
        limit:
          type: integer
        offset:
          type: integer
    OfferStateChangedEvent:
      type: object
      required: [offerId, from, to, occurredAt]
      properties:
        offerId:
          $ref: "#/components/schemas/OfferId"
        from:
          $ref: "#/components/schemas/OfferStatus"
        to:
          $ref: "#/components/schemas/OfferStatus"
        occurredAt:
          type: string
          format: date-time
    Error:
      type: object
      description: RFC 9457 problem details response
      required: [type, title, status]
      properties:
        type:
          type: string
          format: uri-reference
        title:
          type: string
        status:
          type: integer
        detail:
          type: string
        instance:
          type: string
`;
