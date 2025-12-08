"use client"

import { useAuth } from "@/components/auth-provider"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LogIn, LogOut, User } from "lucide-react"

export function LoginButton() {
  const { user, isLoading, signInWithGoogle, signOut } = useAuth()

  if (isLoading) {
    return <div className="w-8 h-8 rounded-full bg-muted animate-pulse" />
  }

  if (!user) {
    return (
      <Button onClick={signInWithGoogle} variant="outline" size="sm" className="gap-2">
        <LogIn className="w-4 h-4" />
        <span className="hidden sm:inline">Sign in</span>
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative h-8 w-8 rounded-full">
          <Avatar className="h-8 w-8">
            <AvatarImage src={user.user_metadata.avatar_url} alt={user.email ?? ""} />
            <AvatarFallback>
              <User className="h-4 w-4" />
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem disabled className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium">{user.user_metadata.full_name || "User"}</p>
            <p className="text-xs text-muted-foreground">{user.email}</p>
          </div>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut} className="text-destructive cursor-pointer">
          <LogOut className="w-4 h-4 mr-2" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

