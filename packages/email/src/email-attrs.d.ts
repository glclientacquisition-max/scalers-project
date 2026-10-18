import "react";

// Legacy HTML attributes that email clients (Outlook, old Gmail) still honour.
declare module "react" {
  interface TdHTMLAttributes<T> {
    bgcolor?: string;
  }
  interface TableHTMLAttributes<T> {
    bgcolor?: string;
  }
}
