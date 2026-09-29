"use client";

import { useState, useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import { MailIcon, MobileIcon } from "@louez/ui/icons";
import { RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogPanel,
} from "@louez/ui";
import { Button } from "@louez/ui";
import { Input } from "@louez/ui";
import { Textarea } from "@louez/ui";
import { Label } from "@louez/ui";
import { Badge } from "@louez/ui";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@louez/ui";
import type { CustomerNotificationEventType, CustomerNotificationTemplate } from "@louez/types";
import type { EmailLocale } from "@/lib/email/i18n";

interface CustomerTemplateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventType: CustomerNotificationEventType;
  template?: CustomerNotificationTemplate;
  onSave: (template: CustomerNotificationTemplate) => void;
  locale: EmailLocale;
}

import { DEFAULT_SUBJECTS, DEFAULT_SMS_TEMPLATES } from './customer-template-defaults'
export { DEFAULT_SUBJECTS, DEFAULT_SMS_TEMPLATES } from './customer-template-defaults'

export function CustomerTemplateModal({
  open,
  onOpenChange,
  eventType,
  template,
  onSave,
  locale,
}: CustomerTemplateModalProps) {
  const t = useTranslations("dashboard.settings.notifications.customerTemplates");
  const tc = useTranslations("common");

  // Get defaults for current locale and event type
  const defaultSubject = useMemo(
    () => DEFAULT_SUBJECTS[locale]?.[eventType] || DEFAULT_SUBJECTS["en"][eventType],
    [locale, eventType],
  );
  const defaultSms = useMemo(
    () => DEFAULT_SMS_TEMPLATES[locale]?.[eventType] || DEFAULT_SMS_TEMPLATES["en"][eventType],
    [locale, eventType],
  );

  // Initialize with custom value if exists, otherwise default
  const [subject, setSubject] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [smsMessage, setSmsMessage] = useState("");

  // Reset state when modal opens or eventType changes
  useEffect(() => {
    if (open) {
      // Use custom template if exists, otherwise show default
      setSubject(template?.subject || defaultSubject);
      setEmailMessage(template?.emailMessage || "");
      setSmsMessage(template?.smsMessage || defaultSms);
    }
  }, [open, eventType, template, defaultSubject, defaultSms]);

  // Check if values are customized (different from default)
  const isSubjectCustomized = subject !== defaultSubject;
  const isSmsCustomized = smsMessage !== defaultSms;
  const isEmailMessageCustomized = emailMessage.trim() !== "";

  const handleSave = () => {
    // Only save non-default values (save undefined to clear customization)
    onSave({
      subject: isSubjectCustomized ? subject : undefined,
      emailMessage: isEmailMessageCustomized ? emailMessage : undefined,
      smsMessage: isSmsCustomized ? smsMessage : undefined,
    });
  };

  const handleResetSubject = () => setSubject(defaultSubject);
  const handleResetSms = () => setSmsMessage(defaultSms);
  const handleResetEmailMessage = () => setEmailMessage("");

  const handleResetAll = () => {
    setSubject(defaultSubject);
    setEmailMessage("");
    setSmsMessage(defaultSms);
  };

  // Calculate SMS character count
  const smsCharCount = smsMessage.length;

  return (
    <TooltipProvider>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">{t("title")}</DialogTitle>
          </DialogHeader>

          <DialogPanel>
            {/* Email Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <MailIcon className="h-4 w-4" />
                {t("emailSection")}
              </div>

              {/* Subject field */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">{t("subject")}</Label>
                  <div className="flex items-center gap-2">
                    {isSubjectCustomized ? (
                      <>
                        <Badge variant="submitted" className="text-[10px] px-1.5 py-0">
                          {t("customized")}
                        </Badge>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={handleResetSubject}
                              />
                            }
                          >
                            <RotateCcw className="h-3 w-3" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{t("resetToDefault")}</p>
                          </TooltipContent>
                        </Tooltip>
                      </>
                    ) : (
                      <Badge variant="submitted" className="text-[10px] px-1.5 py-0">
                        {t("default")}
                      </Badge>
                    )}
                  </div>
                </div>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="text-sm"
                />
                <p className="text-xs text-muted-foreground">{t("subjectHint")}</p>
              </div>

              {/* Additional message field */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">{t("additionalMessage")}</Label>
                  {isEmailMessageCustomized && (
                    <div className="flex items-center gap-2">
                      <Badge variant="expired" className="text-[10px] px-1.5 py-0">
                        {t("customized")}
                      </Badge>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={handleResetEmailMessage}
                            />
                          }
                        >
                          <RotateCcw className="h-3 w-3" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{t("clearMessage")}</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  )}
                </div>
                <Textarea
                  value={emailMessage}
                  onChange={(e) => setEmailMessage(e.target.value)}
                  placeholder={t("additionalMessagePlaceholder")}
                  rows={3}
                  className="text-sm"
                />
                <p className="text-xs text-muted-foreground">{t("additionalMessageHint")}</p>
              </div>
            </div>

            {/* SMS Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <MobileIcon className="h-4 w-4" />
                {t("smsSection")}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">{t("smsMessage")}</Label>
                  <div className="flex items-center gap-2">
                    {isSmsCustomized ? (
                      <>
                        <Badge variant="submitted" className="text-[10px] px-1.5 py-0">
                          {t("customized")}
                        </Badge>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={handleResetSms}
                              />
                            }
                          >
                            <RotateCcw className="h-3 w-3" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{t("resetToDefault")}</p>
                          </TooltipContent>
                        </Tooltip>
                      </>
                    ) : (
                      <Badge variant="expired" className="text-[10px] px-1.5 py-0">
                        {t("default")}
                      </Badge>
                    )}
                  </div>
                </div>
                <Textarea
                  value={smsMessage}
                  onChange={(e) => setSmsMessage(e.target.value)}
                  rows={4}
                  className="text-sm font-mono"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{t("smsVariables")}</span>
                  <span className={smsCharCount > 160 ? "text-destructive font-medium" : ""}>
                    {smsCharCount}/160
                  </span>
                </div>
              </div>
            </div>
          </DialogPanel>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={handleResetAll}>
              {t("resetAll")}
            </Button>
            <div className="flex-1" />
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={handleSave}>{tc("save")}</Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </TooltipProvider>
  );
}
