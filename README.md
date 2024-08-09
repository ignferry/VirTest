# VirTest
Virtest is a performance testing environment setup tool for microservices deployed in Kubernetes. This tool is created to enable early, low resource, and insightful performance testing by leveraging Mountebank for service virtualization of dependencies and OpenTelemetry as well as Grafana Cloud K6 for complete observability.

## Installation
Install Virtest through npm (the Node Package Manager) with the following command.

```
npm install -g @ignferry/virtest
```

This will provide a globally accesibe `virtest` command.

## Requirements
Virtest integrates multiple components and tools used in microservice performance testing which will need to be provided and installed before using this tool as follows:
- **Node JS**: Virtest runs on NodeJS and requires the user to have it installed.
- **Kubernetes Manifests**: Manifests of the microservice need to be provided for the tool to know the components of the microservice.
- **Protofiles**: If the services uses gRPC
- **Kubectl**: Virtest uses the default kubernetes configuration set by Kubectl in the user's local machine.
- **Kubernetes**: This could be Minikube inside the local machine or some managed Kubernetes offerings in the cloud (Ex: GKE).
- **Grafana Cloud Account**: This tool uses Grafana Cloud K6 to visualize performance testing results and store metrics and traces.
- **K6**: Grafana Cloud K6 requires K6 to be used as the load generator. To enable trace corelation, load scripts (defined by the user) should also be configured as described [here](https://grafana.com/docs/grafana-cloud/testing/k6/analyze-results/integration-with-grafana-cloud-traces/).

## Commands
To get more information about the commands provided by Virtest, use the command `virtest --help` or refer to the table below.

 Command            | Description                                                                                                               |
| ------------------| ------------------------------------------------------------------------------------------------------------------------- |
| **init**          | Generate configuration file template.                                                                                     |
| **apply**         | Deploys application to Kubernetes based on configuration file and manifests.                                              |
| **proxy-result**  | Retrieves proxy result.                                                                                                   |
| **delete**        | Deletes an application deployment in Kubernetes based on config file and manifests.                                       |

## How to Use
There are two main tasks supported by this tool:
1. Data definition of virtual services
2. Performance testing with virtual services

Both tasks will be done in a very similar way with the key difference being the use of proxies in the data definition process. For the guide given below, [OpenTelemetry Demo](https://opentelemetry.io/docs/demo/) will be used.

### Data Definition of Virtual Service
1. Prepare the OpenTelemetry Demo manifests and K6 load scripts (you need to define this yourself)
2. Adjust your configuration file to be as shown below
    ```
    observability: 
        deploy: true
        test-id: sample-test-id-1
        grafana-cloud:
            username: {YOUR GRAFANA CLOUD USERNAME (given with your access token, the format is 6 digit numbers)}
            password: {YOUR GRAFANA CLOUD ACCESS TOKEN}
            otlp-endpoint: {YOUR GRAFANA CLOUD OTLP ENDPOINT}
    manifests:
        path: manifest.yaml
        namespace: opentelemetrydemo
    services:
        checkout:
            service-component:
            name: otel-demo-checkoutservice
            virtual-service:
            transport: http
            protocol: grpc
            grpc:
                protofile-path: /proto/demo.proto
                proto-service-name: oteldemo.CheckoutService
            enabled: true
            port: 5001
            proxy: 
                auto-create: true
                save-result: true
                service-name: replaced-checkoutservice
    ```
    The configuration file consists of three main parts. Observability is used to set up OpenTelemetry and Grafana Cloud which will collect and visualize metrics and traces of the microservice. Manifests is used to specify the location of the microservice's Kubernetes manifests and the namespace it will be deployed to. Services is used to specify changes to the manifests such as setting up proxies and Mountebank. It could also deactivate services which don't need to be deployed anymore since it has been replaced by a virtual service.

    In this configuration file, all services will be deployed. However, Mountebank will be added and a proxy will be set up to record requests going into Checkout Service and save the responses.
3. Deploy the microservice
    ```
    virtest apply config.yaml
    ```
4. Run the K6 script with the performance test scenario
    ```
    K6_CLOUD_TRACES_ENABLED=true K6 cloud {script file name}.js
    ```
    A link to Grafana Cloud will be generated in a short moment where you could observe and analyze the performance test results
5. Download the virtual service definition for Checkout Service generated from the proxy
    ```
    virtest proxy-result config.yaml
    ```
    A virtual service specification file will be generated. Here is an example of a virtual service specification generated from the command.
    ```
    {
      "protocol": "grpc",
      "port": 5001,
      "recordRequests": false,
      "stubs": [
          {
          "predicates": [{ "deepEquals": { "path": "/oteldemo.CheckoutService/PlaceOrder" } }],
          "responses": [
            {
              "is": {
                "value": {
                  "order": {
                    "items": [
                      {
                          "item": {
                          "product_id": "9SIQT8TOJO",
                          "quantity": 2
                          },
                          "cost": {
                          "currency_code": "USD",
                          "units": "3599",
                          "nanos": 0
                          }
                      }
                    ],
                    "order_id": "8dc7d347-37c6-11ef-bd9d-ded79d69da12",
                    "shipping_tracking_id": "47c115a3-b808-4ac0-bc36-ca8dd7dc2616",
                    "shipping_cost": {
                      "currency_code": "USD",
                      "units": "17",
                      "nanos": 800000000
                    },
                    "shipping_address": {
                      "street_address": "2200 Mission College Blvd",
                      "city": "Santa Clara",
                      "state": "CA",
                      "country": "United States",
                      "zip_code": "95054"
                    }
                  }
                },
                "metadata": {
                  "initial": {
                      "content-type": "application/grpc"
                  },
                  "trailing": {}
                },
                "_proxyResponseTime": 33
              },
              "behaviors": [
                {
                  "wait": 33
                }
              ]
            }
          ],
          "options": {
            "protobufjs": {
              "includeDirs": [
                "/app/virtest"
              ]
            }
          },
          "services": {
            "oteldemo.CheckoutService": {
              "file": "checkout.proto"
            }
          }
        }
      ]
    }
    ```
6. Once the test scenario has finished, delete the application from Kubernetes
    ```
    virtest delete config.yaml
    ```

### Performance Testing with Virtual Services
This task can be done with mostly the same steps as the data definition task explained before. However, we will need to use a modified configuration file and skip downloading with `virtest proxy-result` as we will not be using any proxies.

Use the configuration file below
```
observability: 
  deploy: true
  test-id: sample-test-id-2
  grafana-cloud:
    username: {YOUR GRAFANA CLOUD USERNAME (given with your access token, the format is 6 digit numbers)}
    password: {YOUR GRAFANA CLOUD ACCESS TOKEN}
    otlp-endpoint: {YOUR GRAFANA CLOUD OTLP ENDPOINT}
manifests:
  path: manifest.yaml
  namespace: opentelemetrydemo
services:
  checkout:
    service-component:
      name: otel-demo-checkoutservice
    deployment-component:
      name: otel-demo-checkoutservice
      enabled: false
    virtual-service:
      transport: http
      protocol: grpc
      grpc:
        protofile-path: /proto/demo.proto
        proto-service-name: oteldemo.CheckoutService
      path: checkout-proxy-result.json
      enabled: true
      port: 5001
  kafka:
    deployment-component:
      name: otel-demo-kafka
      enabled: false
  accounting:
    deployment-component:
      name: otel-demo-accountingservice
      enabled: false
  fraud-detection:
    deployment-component:
      name: otel-demo-frauddetectionservice
      enabled: false
  email:
    deployment-component:
      name: otel-demo-emailservice
      enabled: false
  accounting:
    deployment-component:
      name: otel-demo-accountingservice
      enabled: false
  payment:
    deployment-component:
      name: otel-demo-paymentservice
      enabled: false
  shipping:
    deployment-component:
      name: otel-demo-shippingservice
      enabled: false
  quote:
    deployment-component:
      name: otel-demo-quoteservice
      enabled: false      
```
This configuration file will replace Checkout Service with a virtual service according to the definition received from the previous task. Checkout Service's dependencies are also listed and set not to be deployed to reduce resource usage. This won't cause problems to the system since Checkout Service has been replaced by a Mountebank virtual service and it's dependencies won't be called anymore.