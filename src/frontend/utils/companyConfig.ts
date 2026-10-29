"use client";

import { useState, useEffect } from "react";

export interface CompanyConfig {
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  companyTaxCode: string;
  companyRepresentative: string;
  companyRepresentativeRole: string;
}

export const COMPANY_CONFIG_UPDATED_EVENT = "sales_company_config_updated";

export const getDefaultCompanyConfig = (): CompanyConfig => {
  // ABT (Công ty TNHH Giải pháp Y sinh ABT): thông tin mặc định, Quản trị viên có thể sửa trong cấu hình công ty
  return {
    companyName: "Công ty TNHH Giải pháp Y sinh ABT",
    companyAddress: "Xưởng 6.07 và 5.02, Lô L2, Đường Long Hậu-Hiệp Phước, KCN Long Hậu, Xã Cần Giuộc, Tỉnh Tây Ninh, Việt Nam",
    companyPhone: "028 2216 0885",
    companyEmail: "sales@abtvn.com",
    companyTaxCode: "0315562387",
    companyRepresentative: "NGUYỄN VĂN TÙNG",
    companyRepresentativeRole: "Giám đốc",
  };
};

export const getCompanyConfig = (): CompanyConfig => {
  const defaults = getDefaultCompanyConfig();
  if (typeof window === "undefined") return defaults;

  return {
    companyName: localStorage.getItem("sales_company_name") || defaults.companyName,
    companyAddress: localStorage.getItem("sales_company_address") || defaults.companyAddress,
    companyPhone: localStorage.getItem("sales_company_phone") || defaults.companyPhone,
    companyEmail: localStorage.getItem("sales_company_email") || defaults.companyEmail,
    companyTaxCode: localStorage.getItem("sales_company_tax_code") || defaults.companyTaxCode,
    companyRepresentative: localStorage.getItem("sales_company_representative") || defaults.companyRepresentative,
    companyRepresentativeRole: localStorage.getItem("sales_company_representative_role") || defaults.companyRepresentativeRole,
  };
};

export const dispatchCompanyConfigUpdated = (cfg?: Partial<CompanyConfig>) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(COMPANY_CONFIG_UPDATED_EVENT, { detail: cfg }));
};

export const useCompanyConfig = (): CompanyConfig => {
  const [config, setConfig] = useState<CompanyConfig>(() => getCompanyConfig());

  useEffect(() => {
    // 1. Initial sync with latest in localStorage
    setConfig(getCompanyConfig());

    // 2. Fetch from backend /api/storage to ensure latest persistence
    fetch("/api/storage?key=sales_company_config")
      .then((res) => res.json())
      .then((resData) => {
        if (resData.data && typeof resData.data === "object") {
          const cfg = resData.data;
          const defaults = getDefaultCompanyConfig();
          const updated: CompanyConfig = {
            companyName: cfg.companyName || localStorage.getItem("sales_company_name") || defaults.companyName,
            companyAddress: cfg.companyAddress || localStorage.getItem("sales_company_address") || defaults.companyAddress,
            companyPhone: cfg.companyPhone || localStorage.getItem("sales_company_phone") || defaults.companyPhone,
            companyEmail: cfg.companyEmail || localStorage.getItem("sales_company_email") || defaults.companyEmail,
            companyTaxCode: cfg.companyTaxCode || localStorage.getItem("sales_company_tax_code") || defaults.companyTaxCode,
            companyRepresentative: cfg.companyRepresentative || localStorage.getItem("sales_company_representative") || defaults.companyRepresentative,
            companyRepresentativeRole: cfg.companyRepresentativeRole || localStorage.getItem("sales_company_representative_role") || defaults.companyRepresentativeRole,
          };
          setConfig(updated);
        }
      })
      .catch(() => {});

    // 3. Listen to local and cross-tab storage changes
    const handleStorageChange = () => {
      setConfig(getCompanyConfig());
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener(COMPANY_CONFIG_UPDATED_EVENT, handleStorageChange);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener(COMPANY_CONFIG_UPDATED_EVENT, handleStorageChange);
    };
  }, []);

  return config;
};
