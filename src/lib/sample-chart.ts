import type { ChartFiles } from '@/types/chart'

export const SAMPLE_CHART: ChartFiles = {
  'Chart.yaml': `apiVersion: v2
name: hello
description: A minimal Helm chart for the playground
type: application
version: 0.1.0
appVersion: "1.0.0"
`,
  'values.yaml': `replicaCount: 2

image:
  repository: nginx
  tag: "1.27-alpine"
  pullPolicy: IfNotPresent

service:
  type: ClusterIP
  port: 80

resources:
  limits:
    cpu: 200m
    memory: 128Mi
  requests:
    cpu: 50m
    memory: 64Mi

env:
  GREETING: "hello from helm playground"
`,
  'values.schema.json': `{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "replicaCount": {
      "type": "integer",
      "description": "Number of pod replicas",
      "minimum": 1
    },
    "nameOverride": {
      "type": "string",
      "description": "Override the chart name"
    },
    "image": {
      "type": "object",
      "description": "Container image configuration",
      "properties": {
        "repository": {
          "type": "string",
          "description": "Docker image repository"
        },
        "tag": {
          "type": "string",
          "description": "Docker image tag"
        },
        "pullPolicy": {
          "type": "string",
          "enum": ["Always", "IfNotPresent", "Never"],
          "description": "Image pull policy"
        }
      },
      "required": ["repository", "tag", "pullPolicy"],
      "additionalProperties": false
    },
    "service": {
      "type": "object",
      "description": "Kubernetes Service configuration",
      "properties": {
        "type": {
          "type": "string",
          "enum": ["ClusterIP", "NodePort", "LoadBalancer"],
          "description": "Kubernetes Service type"
        },
        "port": {
          "type": "integer",
          "description": "Service port",
          "minimum": 1,
          "maximum": 65535
        }
      },
      "required": ["type", "port"],
      "additionalProperties": false
    },
    "resources": {
      "type": "object",
      "description": "Container resource limits and requests",
      "properties": {
        "limits": {
          "type": "object",
          "properties": {
            "cpu": {
              "type": "string",
              "description": "CPU limit (e.g. 200m)"
            },
            "memory": {
              "type": "string",
              "description": "Memory limit (e.g. 128Mi)"
            }
          },
          "required": ["cpu", "memory"],
          "additionalProperties": false
        },
        "requests": {
          "type": "object",
          "properties": {
            "cpu": {
              "type": "string",
              "description": "CPU request (e.g. 50m)"
            },
            "memory": {
              "type": "string",
              "description": "Memory request (e.g. 64Mi)"
            }
          },
          "required": ["cpu", "memory"],
          "additionalProperties": false
        }
      },
      "required": ["limits", "requests"],
      "additionalProperties": false
    },
    "env": {
      "type": "object",
      "description": "Environment variables injected into the container",
      "additionalProperties": {
        "type": "string"
      }
    }
  },
  "required": ["replicaCount", "image", "service", "resources"],
  "additionalProperties": false
}
`,
  'values.override.yaml': `# Optional overrides applied after values.yaml.
# Example:
# replicaCount: 5
# image:
#   tag: "1.28-alpine"
`,
  'templates/_helpers.tpl': `{{/*
Expand the name of the chart.
*/}}
{{- define "hello.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Common labels
*/}}
{{- define "hello.labels" -}}
app.kubernetes.io/name: {{ include "hello.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end -}}

{{/*
Selector labels
*/}}
{{- define "hello.selectorLabels" -}}
app.kubernetes.io/name: {{ include "hello.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
`,
  'templates/deployment.yaml': `apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "hello.name" . }}
  labels:
    {{- include "hello.labels" . | nindent 4 }}
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      {{- include "hello.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "hello.selectorLabels" . | nindent 8 }}
    spec:
      containers:
        - name: {{ .Chart.Name }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - name: http
              containerPort: 80
              protocol: TCP
          {{- with .Values.env }}
          env:
            {{- range $k, $v := . }}
            - name: {{ $k }}
              value: {{ $v | quote }}
            {{- end }}
          {{- end }}
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
`,
  'templates/service.yaml': `apiVersion: v1
kind: Service
metadata:
  name: {{ include "hello.name" . }}
  labels:
    {{- include "hello.labels" . | nindent 4 }}
spec:
  type: {{ .Values.service.type }}
  ports:
    - port: {{ .Values.service.port }}
      targetPort: http
      protocol: TCP
      name: http
  selector:
    {{- include "hello.selectorLabels" . | nindent 4 }}
`,
}
