export interface IPaymentDataRaw {
  correlationId: string;
  amount: number;
}

export type TPaymentData = {
  requestedAt: string;
} & IPaymentDataRaw;

export interface IProcessorHealthCheck {
  failing: boolean;
  minResponseTime: number;
}

export interface IProcessorUrl {
  url: string;
  processor: string;
}

export interface ISummaryRaw {
  processor: string;
  total_requests: string;
  total_amount: string;
}

export interface ISummary {
  default: {
    totalRequests: number;
    totalAmount: number;
  };
  fallback: {
    totalRequests: number;
    totalAmount: number;
  };
}
